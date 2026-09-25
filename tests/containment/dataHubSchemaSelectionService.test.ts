import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Data Hub 6.2D3D — governed schema ELIGIBILITY and LINEAGE PINNING:
// establishImportBatchSchemaLineage.ts, its no-body POST route, the client
// httpClient call, the orchestrator's three new states, and the UI's "Use
// governed schema" action. Every workbook is synthetic and built in-memory
// — a minimal single-worksheet/single-column governed schema fixture
// (deliberately NOT the real Onkaparinga config; see
// dataHubSchemaMatchService.test.ts's own header comment and Section 4 of
// the D3D spec: the real Onkaparinga schema stays DRAFT and is never
// mutated by this suite).

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ORG = "org-1";
const OTHER_ORG = "org-2";
const SS = "ss-1";

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
const importBatchUpdateMany = vi.fn();
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
    importBatch: {
      ...writeSurface("importBatch"),
      findUnique: (...a: unknown[]) => reads.importBatchFindUnique(...a),
      updateMany: (...a: unknown[]) => importBatchUpdateMany(...a),
    },
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

// ── Fixed governed identity constants (real, imported — never hardcoded
// duplicates that could silently drift from governedSchema.ts's own). ────
let DT_ID: string;
let SV_ID: string;
let SV_NUMBER: number;

// ── Synthetic single-sheet workbook + governed schema fixture ────────────
const HEADER = "id";
const SHEET_NAME = "Sheet1";

function workbookBytes(headers: string[]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers]), SHEET_NAME);
  wb.Workbook = { Sheets: [{ Hidden: 0 }] };
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

function descriptors() {
  return [{ worksheet_index: 0, worksheet_name: SHEET_NAME, worksheet_visibility: "visible", worksheet_is_empty: false }];
}

function governedRows(status: "DRAFT" | "ACTIVE" | "RETIRED", org = ORG) {
  const worksheets = [
    { id: "gws-1", organisation_id: org, source_schema_version_id: SV_ID, logical_key: "sheet1", expected_name: SHEET_NAME, ordinal_hint: 0, presence: "REQUIRED" },
  ];
  const columns = [{ organisation_id: org, source_schema_worksheet_id: "gws-1", ordinal: 0, source_header: HEADER, presence: "REQUIRED" }];
  const profileVersions = [
    { organisation_id: org, profile_document: { documentVersion: 1, schemaStatus: status, headerRowOneBased: 1 }, profile: { organisation_id: org, source_schema_worksheet_id: "gws-1" } },
  ];
  return { worksheets, columns, profileVersions };
}

function arrange(
  opts: {
    headers?: string[];
    status?: "DRAFT" | "ACTIVE" | "RETIRED";
    batch?: Record<string, unknown>;
    bytes?: Buffer;
    org?: string;
  } = {}
) {
  const headers = opts.headers ?? [HEADER];
  const bytes = opts.bytes ?? workbookBytes(headers);
  const org = opts.org ?? ORG;
  reads.importBatchFindUnique.mockResolvedValue({
    status: "READY",
    deleted_at: null,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    content_type: "xlsx",
    original_filename: "batch.xlsx",
    source_system_id: SS,
    dataset_type_id: null,
    source_schema_version_id: null,
    ...opts.batch,
  });
  reads.uploadFindMany.mockResolvedValue(descriptors());
  reads.sourceSystemFindFirst.mockResolvedValue({ id: SS, organisation_id: org });
  reads.datasetTypeFindFirst.mockResolvedValue({ id: DT_ID, organisation_id: org, source_system_id: SS, active: true });
  reads.sourceSchemaVersionFindFirst.mockResolvedValue({ id: SV_ID, organisation_id: org, dataset_type_id: DT_ID, version_number: SV_NUMBER, status: opts.status ?? "ACTIVE" });
  const g = governedRows(opts.status ?? "ACTIVE", org);
  reads.sourceSchemaWorksheetFindMany.mockResolvedValue(g.worksheets);
  reads.sourceSchemaColumnFindMany.mockResolvedValue(g.columns);
  reads.profileVersionFindMany.mockResolvedValue(g.profileVersions);
  storageGet.mockResolvedValue({ body: bytes });
  importBatchUpdateMany.mockResolvedValue({ count: 1 });
  return bytes;
}

async function service() {
  return (await import("@/lib/data-hub/schemaMatch/establishImportBatchSchemaLineage")).establishImportBatchSchemaLineage;
}
async function runService(importBatchId = "batch-1", organisationId = ORG, actorUserId = "user-1") {
  return (await service())({ organisationId, importBatchId, actorUserId });
}

function expectNoWrites() {
  for (const [name, fn] of Object.entries(writes)) expect(fn, name).not.toHaveBeenCalled();
  expect(importBatchUpdateMany, "importBatch.updateMany").not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
}

beforeEach(async () => {
  const governedSchema = await import("@/lib/data-hub/schemaMatch/governedSchema");
  DT_ID = governedSchema.GOVERNED_DATASET_TYPE_ID;
  SV_ID = governedSchema.GOVERNED_SOURCE_SCHEMA_VERSION_ID;
  SV_NUMBER = governedSchema.GOVERNED_SOURCE_SCHEMA_VERSION_NUMBER;
  for (const fn of Object.values(reads)) fn.mockReset();
  for (const fn of Object.values(writes)) fn.mockReset();
  importBatchUpdateMany.mockReset();
  transaction.mockReset();
  storageGet.mockReset();
  requireRole.mockReset();
  requireRole.mockResolvedValue({ organisationId: ORG, userId: "user-1" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
describe("6.2D3D service — successful path, idempotency, tenant isolation", () => {
  it("1. ACTIVE + EXACT_MATCH pins the exact expected dataset_type_id / source_schema_version_id via one atomic conditional updateMany", async () => {
    arrange({ status: "ACTIVE" });
    const result = await runService();
    expect(result).toMatchObject({ ok: true, alreadySelected: false, importBatchId: "batch-1", datasetTypeId: DT_ID, sourceSchemaVersionId: SV_ID, sourceSchemaVersionNumber: SV_NUMBER });
    expect(importBatchUpdateMany).toHaveBeenCalledTimes(1);
    const call = importBatchUpdateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({
      id: "batch-1",
      organisation_id: ORG,
      deleted_at: null,
      status: "READY",
      source_system_id: SS,
      dataset_type_id: null,
      source_schema_version_id: null,
    });
    expect(call.data).toEqual({ dataset_type_id: DT_ID, source_schema_version_id: SV_ID });
    for (const [name, fn] of Object.entries(writes)) expect(fn, name).not.toHaveBeenCalled();
  });

  it("2. success returns the correct batch id, dataset id, schema version id, version number, alreadySelected: false", async () => {
    arrange({ status: "ACTIVE" });
    const result = await runService("batch-1", ORG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toEqual({ ok: true, alreadySelected: false, importBatchId: "batch-1", datasetTypeId: DT_ID, sourceSchemaVersionId: SV_ID, sourceSchemaVersionNumber: SV_NUMBER });
  });

  it("3. already-pinned identical lineage is idempotent — zero mutation, alreadySelected: true, no fresh storage/parse work performed", async () => {
    arrange({ status: "ACTIVE", batch: { dataset_type_id: DT_ID, source_schema_version_id: SV_ID } });
    const result = await runService();
    expect(result).toMatchObject({ ok: true, alreadySelected: true, datasetTypeId: DT_ID, sourceSchemaVersionId: SV_ID });
    expect(importBatchUpdateMany).not.toHaveBeenCalled();
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("4. wrong-tenant batch id -> BATCH_NOT_FOUND, no existence leak, zero mutation", async () => {
    arrange({ status: "ACTIVE" });
    reads.importBatchFindUnique.mockImplementation(async ({ where }: { where: { id_organisation_id: { id: string; organisation_id: string } } }) =>
      where.id_organisation_id.organisation_id === ORG
        ? { status: "READY", deleted_at: null, sha256: "x", content_type: "xlsx", original_filename: "batch.xlsx", source_system_id: SS, dataset_type_id: null, source_schema_version_id: null }
        : null
    );
    const result = await runService("batch-1", OTHER_ORG);
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
    expectNoWrites();
  });

  it("tombstoned batch -> BATCH_NOT_FOUND (never a distinct code), zero mutation", async () => {
    arrange({ status: "ACTIVE", batch: { deleted_at: new Date() } });
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
    expectNoWrites();
  });
});

describe("6.2D3D service — schema lifecycle (ACTIVE-only)", () => {
  it("5. DRAFT + EXACT_MATCH -> GOVERNED_SCHEMA_NOT_ACTIVE, zero mutation", async () => {
    arrange({ status: "DRAFT" });
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "GOVERNED_SCHEMA_NOT_ACTIVE" });
    expectNoWrites();
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("6. RETIRED — governedSchema.ts's own D3C loader (untouched by D3D; READABLE_SCHEMA_STATUSES = DRAFT|ACTIVE only) never surfaces a RETIRED version as ok:true, so it is indistinguishable from GOVERNED_SCHEMA_UNAVAILABLE here — documented, deliberate: D3D must never widen D3C's read boundary", async () => {
    arrange({ status: "RETIRED" });
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "GOVERNED_SCHEMA_UNAVAILABLE" });
    expectNoWrites();
  });
});

describe("6.2D3D service — match outcomes (EXACT_MATCH only)", () => {
  it("7. MATCH_WITH_NON_BLOCKING_DRIFT (unexpected extra column) -> SCHEMA_EXACT_MATCH_REQUIRED, zero mutation", async () => {
    arrange({ status: "ACTIVE", headers: [HEADER, "extra"] });
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "SCHEMA_EXACT_MATCH_REQUIRED" });
    expectNoWrites();
  });

  it("8. BLOCKING_DRIFT (required column renamed) -> SCHEMA_EXACT_MATCH_REQUIRED, zero mutation", async () => {
    arrange({ status: "ACTIVE", headers: ["renamed"] });
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "SCHEMA_EXACT_MATCH_REQUIRED" });
    expectNoWrites();
  });

  it("9. UNMATCHABLE (worksheet renamed so nothing matches) -> SCHEMA_EXACT_MATCH_REQUIRED, zero mutation", async () => {
    const bytes = (() => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[HEADER]]), "TotallyDifferentSheet");
      wb.Workbook = { Sheets: [{ Hidden: 0 }] };
      return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    })();
    arrange({ status: "ACTIVE", bytes, batch: {} });
    reads.uploadFindMany.mockResolvedValue([{ worksheet_index: 0, worksheet_name: "TotallyDifferentSheet", worksheet_visibility: "visible", worksheet_is_empty: false }]);
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "SCHEMA_EXACT_MATCH_REQUIRED" });
    expectNoWrites();
  });
});

describe("6.2D3D service — integrity", () => {
  it("10. SHA mismatch -> STORAGE_INTEGRITY_MISMATCH, zero mutation", async () => {
    arrange({ status: "ACTIVE", batch: { sha256: "0".repeat(64) } });
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
    expectNoWrites();
  });

  it("11. missing storage object -> STORAGE_NOT_FOUND, zero mutation", async () => {
    arrange({ status: "ACTIVE" });
    const { RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");
    storageGet.mockRejectedValue(new RawFileStoreError("NOT_FOUND", "missing"));
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "STORAGE_NOT_FOUND" });
    expectNoWrites();
  });

  it("provider failure (non-NOT_FOUND storage error) -> PROVIDER_FAILURE, zero mutation", async () => {
    arrange({ status: "ACTIVE" });
    storageGet.mockRejectedValue(new Error("network blip"));
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "PROVIDER_FAILURE" });
    expectNoWrites();
  });

  it("12. parser rejection -> PARSER_REJECTED, zero mutation", async () => {
    arrange({ status: "ACTIVE" });
    const { WorkbookParserError } = await import("@/lib/data-hub/workbookParser");
    storageGet.mockResolvedValue({ body: Buffer.from("not a real xlsx") });
    reads.importBatchFindUnique.mockResolvedValue({
      status: "READY",
      deleted_at: null,
      sha256: createHash("sha256").update(Buffer.from("not a real xlsx")).digest("hex"),
      content_type: "xlsx",
      original_filename: "batch.xlsx",
      source_system_id: SS,
      dataset_type_id: null,
      source_schema_version_id: null,
    });
    void WorkbookParserError;
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "PARSER_REJECTED" });
    expectNoWrites();
  });
});

describe("6.2D3D service — frozen lineage conflict and defensive state", () => {
  it("13. already pinned to a DIFFERENT dataset/schema -> SCHEMA_LINEAGE_CONFLICT, zero mutation, never replaced/upgraded/cleared", async () => {
    arrange({ status: "ACTIVE", batch: { dataset_type_id: "some-other-dataset-type", source_schema_version_id: "some-other-schema-version" } });
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "SCHEMA_LINEAGE_CONFLICT" });
    expectNoWrites();
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("14. anomalous partial lineage (only one of the two columns populated) fails closed with INVALID_STATE, never repaired", async () => {
    arrange({ status: "ACTIVE", batch: { dataset_type_id: DT_ID, source_schema_version_id: null } });
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expectNoWrites();
    expect(storageGet).not.toHaveBeenCalled();

    arrange({ status: "ACTIVE", batch: { dataset_type_id: null, source_schema_version_id: SV_ID } });
    const result2 = await runService();
    expect(result2).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expectNoWrites();
  });

  it("BATCH_NOT_READY, UNSUPPORTED_FORMAT and SOURCE_LINEAGE_REQUIRED all fail before any governed-schema resolution or storage access", async () => {
    arrange({ status: "ACTIVE", batch: { status: "PROCESSING" } });
    expect(await runService()).toMatchObject({ ok: false, code: "BATCH_NOT_READY" });
    expect(reads.sourceSystemFindFirst).not.toHaveBeenCalled();

    reads.sourceSystemFindFirst.mockClear();
    arrange({ status: "ACTIVE", batch: { content_type: "csv" } });
    expect(await runService()).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
    expect(reads.sourceSystemFindFirst).not.toHaveBeenCalled();

    reads.sourceSystemFindFirst.mockClear();
    arrange({ status: "ACTIVE", batch: { source_system_id: null } });
    expect(await runService()).toMatchObject({ ok: false, code: "SOURCE_LINEAGE_REQUIRED" });
    expect(reads.sourceSystemFindFirst).not.toHaveBeenCalled();
  });

  it("no governed schema resolvable -> GOVERNED_SCHEMA_UNAVAILABLE, zero mutation, zero storage access", async () => {
    arrange({ status: "ACTIVE" });
    reads.datasetTypeFindFirst.mockResolvedValue(null);
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "GOVERNED_SCHEMA_UNAVAILABLE" });
    expectNoWrites();
    expect(storageGet).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("6.2D3D concurrency convergence (simulated via the reread branch)", () => {
  it("a lost atomic claim that reread as the SAME expected lineage converges to alreadySelected: true, zero further write", async () => {
    arrange({ status: "ACTIVE" });
    importBatchUpdateMany.mockResolvedValue({ count: 0 });
    reads.importBatchFindUnique
      .mockResolvedValueOnce({
        status: "READY", deleted_at: null, sha256: createHash("sha256").update(workbookBytes([HEADER])).digest("hex"),
        content_type: "xlsx", original_filename: "batch.xlsx", source_system_id: SS, dataset_type_id: null, source_schema_version_id: null,
      })
      .mockResolvedValueOnce({ dataset_type_id: DT_ID, source_schema_version_id: SV_ID });
    const result = await runService();
    expect(result).toMatchObject({ ok: true, alreadySelected: true, datasetTypeId: DT_ID, sourceSchemaVersionId: SV_ID });
    expect(importBatchUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("a lost atomic claim that reread as a DIFFERENT lineage converges to SCHEMA_LINEAGE_CONFLICT, never a silent switch", async () => {
    arrange({ status: "ACTIVE" });
    importBatchUpdateMany.mockResolvedValue({ count: 0 });
    reads.importBatchFindUnique
      .mockResolvedValueOnce({
        status: "READY", deleted_at: null, sha256: createHash("sha256").update(workbookBytes([HEADER])).digest("hex"),
        content_type: "xlsx", original_filename: "batch.xlsx", source_system_id: SS, dataset_type_id: null, source_schema_version_id: null,
      })
      .mockResolvedValueOnce({ dataset_type_id: "some-other-dt", source_schema_version_id: "some-other-sv" });
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "SCHEMA_LINEAGE_CONFLICT" });
  });

  it("a lost atomic claim whose reread shows the batch still fully unpinned (e.g. status changed away from READY concurrently) fails closed with INVALID_STATE", async () => {
    arrange({ status: "ACTIVE" });
    importBatchUpdateMany.mockResolvedValue({ count: 0 });
    reads.importBatchFindUnique
      .mockResolvedValueOnce({
        status: "READY", deleted_at: null, sha256: createHash("sha256").update(workbookBytes([HEADER])).digest("hex"),
        content_type: "xlsx", original_filename: "batch.xlsx", source_system_id: SS, dataset_type_id: null, source_schema_version_id: null,
      })
      .mockResolvedValueOnce({ dataset_type_id: null, source_schema_version_id: null });
    const result = await runService();
    expect(result).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("6.2D3D route — POST /api/data-hub/import-batches/[id]/schema-selection", () => {
  async function route() {
    return import("@/app/api/data-hub/import-batches/[id]/schema-selection/route");
  }

  it("401/403 before any lookup; private no-store; never reads a request body", async () => {
    const { POST } = await route();
    for (const [msg, status] of [["Unauthorized", 401], ["Forbidden", 403]] as const) {
      requireRole.mockReset();
      requireRole.mockRejectedValue(new Error(msg));
      const res = await POST(new Request("http://x", { method: "POST" }) as never, { params: Promise.resolve({ id: "batch-1" }) });
      expect(res.status).toBe(status);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(requireRole).toHaveBeenCalledWith("manager");
    expect(reads.importBatchFindUnique).not.toHaveBeenCalled();
  });

  it("200 newly selected", async () => {
    arrange({ status: "ACTIVE" });
    const { POST } = await route();
    const res = await POST(new Request("http://x", { method: "POST" }) as never, { params: Promise.resolve({ id: "batch-1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toEqual({ ok: true, alreadySelected: false, importBatchId: "batch-1", datasetTypeId: DT_ID, sourceSchemaVersionId: SV_ID, sourceSchemaVersionNumber: SV_NUMBER });
  });

  it("200 idempotent replay", async () => {
    arrange({ status: "ACTIVE", batch: { dataset_type_id: DT_ID, source_schema_version_id: SV_ID } });
    const { POST } = await route();
    const res = await POST(new Request("http://x", { method: "POST" }) as never, { params: Promise.resolve({ id: "batch-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, alreadySelected: true });
  });

  it("exact status mapping for every failure code", async () => {
    const { POST } = await route();

    async function expectCode(setup: () => unknown, code: string, status: number) {
      await setup();
      const res = await POST(new Request("http://x", { method: "POST" }) as never, { params: Promise.resolve({ id: "batch-1" }) });
      expect(res.status, code).toBe(status);
      const body = await res.json();
      expect(body.code, code).toBe(code);
    }

    await expectCode(() => arrange({ status: "ACTIVE", batch: { deleted_at: new Date() } }), "BATCH_NOT_FOUND", 404);
    await expectCode(() => arrange({ status: "ACTIVE", batch: { status: "PROCESSING" } }), "BATCH_NOT_READY", 409);
    await expectCode(() => arrange({ status: "ACTIVE", batch: { content_type: "csv" } }), "UNSUPPORTED_FORMAT", 422);
    await expectCode(() => arrange({ status: "ACTIVE", batch: { source_system_id: null } }), "SOURCE_LINEAGE_REQUIRED", 409);
    await expectCode(() => {
      arrange({ status: "ACTIVE" });
      reads.datasetTypeFindFirst.mockResolvedValue(null);
    }, "GOVERNED_SCHEMA_UNAVAILABLE", 409);
    await expectCode(() => arrange({ status: "DRAFT" }), "GOVERNED_SCHEMA_NOT_ACTIVE", 409);
    await expectCode(() => arrange({ status: "ACTIVE", headers: [HEADER, "extra"] }), "SCHEMA_EXACT_MATCH_REQUIRED", 409);
    await expectCode(() => arrange({ status: "ACTIVE", batch: { dataset_type_id: "x", source_schema_version_id: "y" } }), "SCHEMA_LINEAGE_CONFLICT", 409);
    await expectCode(() => arrange({ status: "ACTIVE", batch: { dataset_type_id: "x", source_schema_version_id: null } }), "INVALID_STATE", 409);
    await expectCode(() => arrange({ status: "ACTIVE", batch: { sha256: "0".repeat(64) } }), "STORAGE_INTEGRITY_MISMATCH", 500);
    await expectCode(async () => {
      arrange({ status: "ACTIVE" });
      const { RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");
      storageGet.mockRejectedValue(new RawFileStoreError("NOT_FOUND", "missing"));
    }, "STORAGE_NOT_FOUND", 404);
    await expectCode(() => {
      arrange({ status: "ACTIVE" });
      storageGet.mockRejectedValue(new Error("network blip"));
    }, "PROVIDER_FAILURE", 500);
  });

  it("a caller-supplied JSON body (schema id / dataset id / override / organisationId / actorUserId) has zero effect — never even parsed", async () => {
    arrange({ status: "ACTIVE" });
    const { POST } = await route();
    const req = new Request("http://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceSchemaVersionId: "evil-version",
        datasetTypeId: "evil-dataset",
        override: true,
        organisationId: "org-evil",
        actorUserId: "user-evil",
      }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: "batch-1" }) });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, datasetTypeId: DT_ID, sourceSchemaVersionId: SV_ID });
    expect(requireRole).toHaveBeenCalledWith("manager");
  });

  it("unexpected exception -> 500, no workbook/DB detail leaked", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    arrange({ status: "ACTIVE" });
    reads.importBatchFindUnique.mockRejectedValue(new Error("db failure SECRET-DETAIL"));
    const { POST } = await route();
    const res = await POST(new Request("http://x", { method: "POST" }) as never, { params: Promise.resolve({ id: "batch-1" }) });
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.stringify(await res.json())).not.toContain("SECRET-DETAIL");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("SECRET-DETAIL");
  });

  it("the route reads no request body and derives every input from session + path id only", () => {
    const src = stripComments(read("app/api/data-hub/import-batches/[id]/schema-selection/route.ts"));
    expect(src).not.toMatch(/req\.(json|text|formData|arrayBuffer|body)|searchParams|nextUrl|headers\.get/);
    expect(src).toMatch(/organisationId: session\.organisationId/);
    expect(src).toMatch(/actorUserId: session\.userId/);
    expect(src).toMatch(/importBatchId: id/);
    expect(src).toMatch(/requireRole\("manager"\)/);
    expect(src).not.toMatch(/export async function (GET|PUT|PATCH|DELETE)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("6.2D3D no-write-outside-lineage-pin / boundary proof (static)", () => {
  it("the service's exact Prisma write surface is exactly one conditional importBatch.updateMany, never a $transaction", () => {
    const src = stripComments(read("lib/data-hub/schemaMatch/establishImportBatchSchemaLineage.ts"));
    const writeCalls = src.match(/\b(prisma|tx)\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g) ?? [];
    expect(writeCalls).toEqual(["prisma.importBatch.updateMany("]);
    expect(src).not.toMatch(/\$transaction|\$executeRaw|\$queryRaw|auditLog|writeAudit/);
  });

  it("confirmWorksheet / reconciliation / illegalDumpingMapper are never IMPORTED by any D3D file, and canonical_status/period columns are never touched", () => {
    for (const rel of [
      "lib/data-hub/schemaMatch/establishImportBatchSchemaLineage.ts",
      "app/api/data-hub/import-batches/[id]/schema-selection/route.ts",
    ]) {
      const src = stripComments(read(rel));
      expect(src, rel).not.toMatch(/from\s+["'][^"']*(confirmWorksheet|reconciliation|illegalDumpingMapper)["']/);
      expect(src, rel).not.toMatch(/canonical_status|period_start|period_end/);
    }
  });

  it("no D3D server file ships to the browser: client/UI code never imports the server service", () => {
    for (const rel of [
      "lib/data-hub/client/orchestrator.ts",
      "lib/data-hub/client/types.ts",
      "lib/data-hub/client/httpClient.ts",
      "app/data-hub/import/_components/SchemaMatchReportPanel.tsx",
      "app/data-hub/import/schemaMatchCopy.ts",
    ]) {
      expect(read(rel), rel).not.toMatch(/from\s+["'][^"']*(establishImportBatchSchemaLineage|schemaMatch\/governedSchema|workbookParser|lib\/prisma|\/prisma["'])/);
    }
  });

  it("no OpenAPI/Spectral infrastructure was introduced by this phase", () => {
    expect(fs.existsSync(path.join(ROOT, ".spectral.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, ".spectral.yml"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "openapi.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "openapi.json"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("6.2D3D client orchestrator — selectGovernedSchema phase transitions", () => {
  function worksheetDTO(index: number) {
    return {
      id: `ws-${index}`, worksheetIndex: index, worksheetName: `Sheet ${index}`, worksheetVisibility: "visible", worksheetIsEmpty: false,
      canonicalStatus: "AWAITING_CONFIRMATION", importBatchId: "batch-1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      confirmedBy: null, confirmedAt: null, lastAttemptAt: null, attemptCount: 0, lastFailureCode: null, lastFailureMessage: null,
      lastFailureRetryable: null, importedRowCount: null, periodStart: null, periodEnd: null, periodSource: null, reportingPeriodRequired: false,
    };
  }
  const worksheets = [worksheetDTO(0)];
  const REPORT_ACTIVE_EXACT = {
    reportVersion: 1, sourceSchemaVersionId: SV_ID, sourceSchemaVersionNumber: 1, sourceSchemaStatus: "ACTIVE", result: "EXACT_MATCH",
    exactMatch: true, blocking: false, observedWorksheetCount: 1, governedWorksheetCount: 1, matchedWorksheetCount: 1, missingRequiredWorksheetCount: 0,
    missingOptionalWorksheetCount: 0, unexpectedWorksheetCount: 0, totalDifferenceCount: 0, blockingDifferenceCount: 0, warningDifferenceCount: 0, differences: [],
  };
  const REPORT_DRAFT_EXACT = { ...REPORT_ACTIVE_EXACT, sourceSchemaStatus: "DRAFT" };

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  async function readySession(selectionResponse: () => Promise<Response> | Response, report: Record<string, unknown> = REPORT_ACTIVE_EXACT) {
    const calls: string[] = [];
    const wrapped = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const u = String(input).replace(/^https?:\/\/[^/]*/, "");
      calls.push(`${method} ${u}`);
      if (method === "POST" && u.endsWith("/inspect")) {
        return jsonResponse(200, { ok: true, worksheets: worksheets.map(({ worksheetIndex, worksheetName, worksheetVisibility, worksheetIsEmpty, canonicalStatus }) => ({ worksheetIndex, worksheetName, worksheetVisibility, worksheetIsEmpty, canonicalStatus })) });
      }
      if (method === "GET" && u.endsWith("/worksheets")) return jsonResponse(200, { worksheets });
      if (method === "GET" && u.endsWith("/schema-match")) return jsonResponse(200, { ok: true, report });
      if (method === "POST" && u.endsWith("/schema-selection")) return selectionResponse();
      if (method === "GET" && /\/import-batches\/[^/]+$/.test(u)) {
        return jsonResponse(200, { batch: { id: "batch-1", status: "READY", originalFilename: "w.xlsx", contentType: "xlsx", sizeBytes: 8, sourceSystemId: "ss-1", createdAt: "x", updatedAt: "x", sha256: "abc", uploadedBy: "u", attemptCount: 1, lastAttemptAt: null, lastFailureCode: null, lastFailureMessage: null, lastFailureRetryable: null, deletedAt: null } });
      }
      throw new Error(`unexpected request: ${method} ${u}`);
    });
    const { createIllegalDumpingImportSession } = await import("@/lib/data-hub/client/orchestrator");
    const session = createIllegalDumpingImportSession({ fetchImpl: wrapped });
    await session.resumeFromBatchId("batch-1");
    await session.compareToGovernedSchema();
    return { session, calls };
  }

  it("ACTIVE + EXACT_MATCH: selectGovernedSchema() -> schemaSelectionSaving -> schemaSelected, POST carries no body", async () => {
    const { session, calls } = await readySession(async () => new Response(JSON.stringify({ ok: true, alreadySelected: false, importBatchId: "batch-1", datasetTypeId: DT_ID, sourceSchemaVersionId: SV_ID, sourceSchemaVersionNumber: 1 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    expect(session.getState().phase).toBe("schemaMatchReady");
    const pending = session.selectGovernedSchema();
    expect(session.getState().phase).toBe("schemaSelectionSaving");
    await pending;
    expect(session.getState()).toMatchObject({ phase: "schemaSelected", alreadySelected: false, datasetTypeId: DT_ID, sourceSchemaVersionId: SV_ID, sourceSchemaVersionNumber: 1 });
    const postCall = calls.find((c) => c.includes("/schema-selection"));
    expect(postCall).toBe("POST /api/data-hub/import-batches/batch-1/schema-selection");
  });

  it("failed POST -> schemaSelectionFailed", async () => {
    const { session } = await readySession(async () => new Response(JSON.stringify({ ok: false, error: "conflict", code: "SCHEMA_LINEAGE_CONFLICT" }), { status: 409, headers: { "Content-Type": "application/json" } }));
    await session.selectGovernedSchema();
    expect(session.getState()).toMatchObject({ phase: "schemaSelectionFailed", code: "SCHEMA_LINEAGE_CONFLICT" });
  });

  it("selectGovernedSchema() throws from any other phase (e.g. schemaMatchLoading, or a DRAFT-status report)", async () => {
    const { session } = await readySession(async () => new Response("{}"), REPORT_DRAFT_EXACT);
    await expect(session.selectGovernedSchema()).rejects.toThrow(/ACTIVE \+ EXACT_MATCH/);
  });

  it("confirm/mapping/period/preview stay blocked from schemaSelected", async () => {
    const { session } = await readySession(async () => new Response(JSON.stringify({ ok: true, alreadySelected: false, importBatchId: "batch-1", datasetTypeId: DT_ID, sourceSchemaVersionId: SV_ID, sourceSchemaVersionNumber: 1 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await session.selectGovernedSchema();
    expect(session.getState().phase).toBe("schemaSelected");
    await expect(session.confirm()).rejects.toThrow(/unexpected phase/);
    session.backToWorksheetInventory();
    expect(session.getState().phase).toBe("worksheetInventoryReady");
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("6.2D3D UI — 'Use governed schema' action visibility", () => {
  const batch = { id: "batch-1", status: "READY" as const, originalFilename: "w.xlsx", contentType: "xlsx", sizeBytes: 8, sourceSystemId: "ss-1" };
  const BASE_REPORT = {
    reportVersion: 1, sourceSchemaVersionId: SV_ID, sourceSchemaVersionNumber: 1, sourceSchemaStatus: "ACTIVE", result: "EXACT_MATCH",
    exactMatch: true, blocking: false, observedWorksheetCount: 1, governedWorksheetCount: 1, matchedWorksheetCount: 1, missingRequiredWorksheetCount: 0,
    missingOptionalWorksheetCount: 0, unexpectedWorksheetCount: 0, totalDifferenceCount: 0, blockingDifferenceCount: 0, warningDifferenceCount: 0, differences: [],
  };

  async function renderReady(report: Record<string, unknown>) {
    const { default: Panel } = await import("@/app/data-hub/import/_components/SchemaMatchReportPanel");
    const state = { phase: "schemaMatchReady" as const, batch, worksheets: [], report: report as never };
    return renderToStaticMarkup(createElement(Panel, { state, onBack: () => {}, onRetry: () => {}, onSelectSchema: () => {}, onRestart: () => {} }));
  }

  it("ACTIVE + EXACT_MATCH -> action visible", async () => {
    const html = await renderReady(BASE_REPORT);
    expect(html).toContain("Use governed schema");
  });

  it("DRAFT + EXACT_MATCH -> action absent, explanatory notice shown instead", async () => {
    const html = await renderReady({ ...BASE_REPORT, sourceSchemaStatus: "DRAFT" });
    expect(html).not.toContain("Use governed schema");
    expect(html).toContain("not currently active for imports");
  });

  it("MATCH_WITH_NON_BLOCKING_DRIFT -> action absent", async () => {
    const html = await renderReady({ ...BASE_REPORT, result: "MATCH_WITH_NON_BLOCKING_DRIFT", exactMatch: false });
    expect(html).not.toContain("Use governed schema");
  });

  it("BLOCKING_DRIFT -> action absent", async () => {
    const html = await renderReady({ ...BASE_REPORT, result: "BLOCKING_DRIFT", exactMatch: false, blocking: true });
    expect(html).not.toContain("Use governed schema");
  });

  it("UNMATCHABLE -> action absent", async () => {
    const html = await renderReady({ ...BASE_REPORT, result: "UNMATCHABLE", exactMatch: false, blocking: true, matchedWorksheetCount: 0 });
    expect(html).not.toContain("Use governed schema");
  });

  it("no override/warning-acknowledgement control anywhere in the panel", async () => {
    const html = await renderReady(BASE_REPORT);
    expect(html).not.toMatch(/override|acknowledge|force/i);
  });
});
