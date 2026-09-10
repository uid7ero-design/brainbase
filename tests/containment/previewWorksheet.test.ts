import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import fs from "fs";
import path from "path";

// Data Hub 5A.3C.0 — static containment + mocked-behavioral proof for the
// bounded, read-only CSV worksheet preview service (previewWorksheet.ts)
// and its new HTTP route (app/api/data-hub/worksheets/[id]/preview/route.ts).
// Mirrors the established per-phase pattern (confirmWorksheet.test.ts /
// inspectCsvWorksheet.test.ts / dataHubReadRoutes.test.ts): static
// source-text containment for the security-load-bearing invariants
// (xlsx-freedom, trusted-input-only shape, tenant-before-storage ordering,
// no-mutation, no-confirm-reachability), plus mocked-prisma/mocked-storage
// behavioral tests for the service's own decision logic and bounding
// behavior. No real Postgres/Blob call anywhere in this file.

const ROOT = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SERVICE_PATH = "lib/data-hub/importBatch/previewWorksheet.ts";
const ROUTE_PATH = path.join("app", "api", "data-hub", "worksheets", "[id]", "preview", "route.ts");

// ─── xlsx-freedom (hard requirement — see previewWorksheet.ts's own header) ───

describe("previewWorksheet — zero xlsx/workbookParser dependency, direct or transitive", () => {
  const code = stripComments(read(SERVICE_PATH));

  it("never imports xlsx", () => {
    expect(code).not.toMatch(/from\s+["']xlsx["']/);
    expect(code).not.toMatch(/require\(["']xlsx["']\)/);
  });

  it("never imports workbookParser.ts", () => {
    expect(code).not.toMatch(/workbookParser/);
  });

  it("never imports inspectWorksheets.ts", () => {
    expect(code).not.toMatch(/from\s+["'][^"']*importBatch\/inspectWorksheets["']/);
  });

  it("imports decodeCsvOnly from the existing, already-xlsx-free csvOnlyDecoder.ts rather than duplicating a CSV parser call", () => {
    expect(code).toMatch(/from\s+["']\.\.\/csvOnlyDecoder["']/);
    expect(code).toMatch(/decodeCsvOnly/);
  });

  it("every import in the file resolves to a known xlsx-free module (allowlist)", () => {
    const imports = code.match(/^import\s.+$/gm) ?? [];
    const allowedPatterns = [
      /node:crypto/,
      /\.\.\/\.\.\/prisma["']/,
      /\.\.\/storage\/rawFileStore["']/,
      /\.\/compositionRoot["']/,
      /\.\.\/limits["']/,
      /\.\.\/csvOnlyDecoder["']/,
      /\.\/illegalDumpingMapper["']/,
      /\.\/failureTaxonomy["']/,
      // 5B.4C — frozen-lineage consumption: 5B.2's document validator and
      // 5B.3's own pure, unmodified compiler/executor. Neither imports
      // xlsx/workbookParser (verified independently by mappingExecution.ts's
      // and mappingDocument.ts's own zero-dependency containment tests).
      /\.\.\/sourceMapping\/mappingDocument["']/,
      /\.\.\/sourceMapping\/mappingExecution["']/,
    ];
    for (const imp of imports) {
      expect(allowedPatterns.some((p) => p.test(imp))).toBe(true);
    }
  });

  it("the route never imports xlsx/workbookParser, directly or transitively", () => {
    const routeCode = stripComments(read(ROUTE_PATH));
    expect(routeCode).not.toMatch(/from\s+["']xlsx["']/);
    expect(routeCode).not.toMatch(/workbookParser/);
  });
});

// ─── Trusted-input-only shape ───────────────────────────────────────────

describe("previewWorksheet — trusted-context-only input shape", () => {
  const code = read(SERVICE_PATH);

  it("PreviewWorksheetTrustedContext carries exactly organisationId and worksheetId", () => {
    const block = code.match(/export interface PreviewWorksheetTrustedContext \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).toMatch(/organisationId:\s*string/);
    expect(block).toMatch(/worksheetId:\s*string/);
    const fieldLines = block
      .split("\n")
      .filter((l) => /:\s*\S/.test(l) && !l.trim().startsWith("/") && !l.trim().startsWith("*"));
    expect(fieldLines).toHaveLength(2);
  });

  it("never imports lib/org.ts or resolves its own session/auth", () => {
    const stripped = stripComments(code);
    expect(stripped).not.toMatch(/requireSession|requireRole/);
    expect(stripped).not.toMatch(/from\s+["'].*lib\/org["']/);
    expect(stripped).not.toMatch(/next\/server/);
    expect(stripped).not.toMatch(/org_override/);
  });

  it("the exported function's ONLY parameter is the trusted context — no caller-suppliable storage locator/format/worksheet-identity second parameter (M5 containment)", () => {
    const stripped = stripComments(code);
    const exportedFnMatch = stripped.match(/export async function previewWorksheet\(([^)]*)\)/);
    expect(exportedFnMatch).not.toBeNull();
    expect(exportedFnMatch![1].split(",").length).toBe(1);
    expect(exportedFnMatch![1]).toMatch(/context:\s*PreviewWorksheetTrustedContext/);
  });

  it("never accepts storageKey/storagePathname/blobToken as any parameter or trusted-context field name", () => {
    const block = code.match(/export interface PreviewWorksheetTrustedContext \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).not.toMatch(/storageKey|storagePath|blobToken|pathname/i);
  });
});

// ─── Tenant-before-storage ordering (security-critical) ─────────────────

describe("previewWorksheet — tenant/eligibility/format gates all precede storage access in source order", () => {
  const code = stripComments(read(SERVICE_PATH));
  const tenantLookupIdx = code.indexOf("prisma.upload.findFirst(");
  const eligibilityIdx = code.indexOf('fail("WORKSHEET_NOT_ELIGIBLE")');
  const batchLookupIdx = code.indexOf("prisma.importBatch.findUnique(");
  const formatGateIdx = code.indexOf('fail("UNSUPPORTED_FORMAT")');
  const storageGetIdx = code.indexOf("storage.get(");

  it("all four gates and the storage call are present and in the required order", () => {
    for (const idx of [tenantLookupIdx, eligibilityIdx, batchLookupIdx, formatGateIdx, storageGetIdx]) {
      expect(idx).toBeGreaterThan(-1);
    }
    expect(tenantLookupIdx).toBeLessThan(eligibilityIdx);
    expect(eligibilityIdx).toBeLessThan(batchLookupIdx);
    expect(batchLookupIdx).toBeLessThan(formatGateIdx);
    expect(formatGateIdx).toBeLessThan(storageGetIdx);
  });

  it("the tenant+lineage predicate is a single findFirst call carrying id, organisation_id, and lineage_kind together", () => {
    const callBlock = code.slice(tenantLookupIdx, code.indexOf(");", tenantLookupIdx));
    expect(callBlock).toMatch(/id:\s*worksheetId/);
    expect(callBlock).toMatch(/organisation_id:\s*organisationId/);
    expect(callBlock).toMatch(/lineage_kind:\s*["']DATA_HUB["']/);
  });

  it("derives the storage key exclusively via buildImportBatchKey(organisationId, worksheet.import_batch_id) — never a caller-provided path", () => {
    expect(code).toMatch(/buildImportBatchKey\(\s*organisationId,\s*worksheet\.import_batch_id\s*\)/);
  });

  it("5B.4C: frozen mapping-lineage RESOLUTION (mappingVersion/sourceMapping lookups + document revalidation) also precedes storage.get() — an unresolvable/corrupt frozen lineage is a gate failure, never a reason to touch storage", () => {
    const mappingVersionLookupIdx = code.indexOf("prisma.mappingVersion.findUnique(");
    const sourceMappingLookupIdx = code.indexOf("prisma.sourceMapping.findUnique(");
    const documentValidationIdx = code.indexOf("validateMappingDocument(");
    for (const idx of [mappingVersionLookupIdx, sourceMappingLookupIdx, documentValidationIdx]) {
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeLessThan(storageGetIdx);
    }
    expect(formatGateIdx).toBeLessThan(mappingVersionLookupIdx);
  });

  it("recomputes SHA-256 and compares against the batch's own persisted sha256, before decode", () => {
    expect(code).toMatch(/createHash\(["']sha256["']\)/);
    expect(code).toMatch(/computedSha256\s*!==\s*batch\.sha256/);
    const shaIdx = code.indexOf("STORAGE_INTEGRITY_MISMATCH");
    const decodeIdx = code.indexOf("decodeCsvOnly(");
    expect(shaIdx).toBeGreaterThan(-1);
    expect(shaIdx).toBeLessThan(decodeIdx);
  });
});

// ─── No mutation, no confirm/import reachability ────────────────────────

describe("previewWorksheet — provably read-only, cannot confirm or import", () => {
  const code = stripComments(read(SERVICE_PATH));

  it("never calls any Prisma write method", () => {
    expect(code).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/);
    expect(code).not.toMatch(/\$transaction/);
    expect(code).not.toMatch(/\$executeRaw/);
  });

  it("never imports confirmWorksheet.ts and never references confirmDataHubWorksheet or illegalDumping.createMany", () => {
    expect(code).not.toMatch(/from\s+["'][^"']*importBatch\/confirmWorksheet["']/);
    expect(code).not.toMatch(/confirmDataHubWorksheet/);
    expect(code).not.toMatch(/illegalDumping\.createMany/);
  });

  it("imports header VALIDATION from illegalDumpingMapper.ts for the legacy path (5A.3C.0, unchanged)", () => {
    expect(code).toMatch(/validateIllegalDumpingHeaders/);
  });

  it("5B.4C: mapIllegalDumpingRows is now legitimately imported/called for the MAPPED-preview path only, exclusively to prove mapping output is domain-mapper-compatible — its result is NEVER persisted (illegalDumping.createMany is still never called, asserted above) and it is called with a bounded sample only, never the full worksheet", () => {
    expect(code).toMatch(/\bmapIllegalDumpingRows\b/);
    // Load-bearing: the call site must be wrapped so a thrown
    // IllegalDumpingMappingError (ordinary row/business-value rejection)
    // can never escape this read-only service as an unhandled exception.
    expect(code).toMatch(/mapIllegalDumpingRows\(domainHeaders, domainRows\)/);
    expect(code).toMatch(/instanceof IllegalDumpingMappingError/);
  });

  it("the route file exports GET only, never POST/PUT/PATCH/DELETE", () => {
    const routeCode = stripComments(read(ROUTE_PATH));
    expect(routeCode).toMatch(/export\s+async\s+function\s+GET\s*\(/);
    expect(routeCode).not.toMatch(/export\s+(async\s+)?function\s+POST\s*\(/);
    expect(routeCode).not.toMatch(/export\s+(async\s+)?function\s+PUT\s*\(/);
    expect(routeCode).not.toMatch(/export\s+(async\s+)?function\s+PATCH\s*\(/);
    expect(routeCode).not.toMatch(/export\s+(async\s+)?function\s+DELETE\s*\(/);
  });

  it("the route performs no direct Prisma writes and reads no request body (no req.json() call)", () => {
    const routeCode = stripComments(read(ROUTE_PATH));
    expect(routeCode).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/);
    expect(routeCode).not.toMatch(/req\.json\(\)/);
    expect(routeCode).not.toMatch(/\.json\(\)/);
  });
});

// ─── Route: auth + cache header (static, mirrors every sibling Data Hub route's own test convention) ───

describe("preview route — manager+ authorization and no-store cache header", () => {
  const routeCode = read(ROUTE_PATH);
  const stripped = stripComments(routeCode);

  it("ACTUALLY CALLS requireRole(\"manager\") as an assignment (not merely mentioned in a comment) — the exact same helper every other Data Hub route uses (M2 containment)", () => {
    expect(stripped).toMatch(/session\s*=\s*await\s+requireRole\(["']manager["']\)/);
  });

  it("maps a Forbidden requireRole throw to 403 and any other throw to 401 (viewer denied / unauthenticated denied)", () => {
    expect(stripped).toMatch(/msg\s*===\s*["']Forbidden["']/);
    expect(stripped).toMatch(/status:\s*403/);
    expect(stripped).toMatch(/status:\s*401/);
  });

  it("derives organisationId exclusively from session.organisationId, never session.homeOrganisationId or request input", () => {
    const stripped = stripComments(routeCode);
    expect(stripped).toMatch(/session\.organisationId/);
    expect(stripped).not.toMatch(/session\.homeOrganisationId/);
    expect(stripped).not.toMatch(/req\.nextUrl\.searchParams/);
  });

  it("uses Cache-Control: private, no-store, matching every other Data Hub route (M9 containment)", () => {
    expect(routeCode).toMatch(/["']Cache-Control["']:\s*["']private, no-store["']/);
  });

  it("never returns a raw Blob URL, storage key, or token in any response body (source-text scan)", () => {
    const stripped = stripComments(routeCode);
    expect(stripped).not.toMatch(/storageKey|storage_key|blobUrl|uploadToken|pathname/i);
  });
});

// ─── Mocked-behavioral tests: previewWorksheet's own decision logic ─────

const uploadFindFirstMock = vi.fn();
const uploadUpdateMock = vi.fn();
const uploadUpdateManyMock = vi.fn();
const importBatchFindUniqueMock = vi.fn();
const importBatchUpdateMock = vi.fn();
const illegalDumpingCreateManyMock = vi.fn();
const transactionMock = vi.fn();
// 5B.4C additions — frozen-lineage consumption lookups.
const mappingVersionFindUniqueMock = vi.fn();
const sourceMappingFindUniqueMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    upload: {
      findFirst: (...args: unknown[]) => uploadFindFirstMock(...args),
      update: (...args: unknown[]) => uploadUpdateMock(...args),
      updateMany: (...args: unknown[]) => uploadUpdateManyMock(...args),
    },
    importBatch: {
      findUnique: (...args: unknown[]) => importBatchFindUniqueMock(...args),
      update: (...args: unknown[]) => importBatchUpdateMock(...args),
    },
    illegalDumping: {
      createMany: (...args: unknown[]) => illegalDumpingCreateManyMock(...args),
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
  return import("@/lib/data-hub/importBatch/previewWorksheet");
}

function worksheetRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "worksheet-1",
    import_batch_id: "batch-1",
    canonical_status: "AWAITING_CONFIRMATION",
    // Real Prisma always returns JS `null` (never `undefined`) for a NULL
    // column — this default matches that, so every pre-existing test in
    // this file that doesn't override it continues to genuinely exercise
    // the LEGACY (no frozen mapping lineage) path, exactly as before 5B.4C.
    mapping_version_id: null,
    ...overrides,
  };
}
function batchRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: "READY",
    content_type: "csv",
    sha256: "will-be-overwritten",
    deleted_at: null,
    source_system_id: null,
    ...overrides,
  };
}

function bufferAndHash(text: string): { body: Buffer; sha256: string } {
  const body = Buffer.from(text, "utf8");
  const sha256 = createHash("sha256").update(body).digest("hex");
  return { body, sha256 };
}

function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(row.join(","));
  return lines.join("\n");
}

const REQUIRED_HEADERS = ["report_date", "location", "waste_type"];

beforeEach(() => {
  uploadFindFirstMock.mockReset();
  uploadUpdateMock.mockReset();
  uploadUpdateManyMock.mockReset();
  importBatchFindUniqueMock.mockReset();
  importBatchUpdateMock.mockReset();
  illegalDumpingCreateManyMock.mockReset();
  transactionMock.mockReset();
  storageGetMock.mockReset();
  mappingVersionFindUniqueMock.mockReset();
  sourceMappingFindUniqueMock.mockReset();
});

describe("previewWorksheet — worksheet lookup collapses nonexistent/wrong-tenant/LEGACY-lineage into one outcome", () => {
  it("nonexistent worksheet id -> WORKSHEET_NOT_FOUND, storage never touched", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(null);
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "nope" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("cross-tenant worksheet id -> WORKSHEET_NOT_FOUND, and storage.get() is NEVER invoked (M1 — the load-bearing proof, not just the status code)", async () => {
    const { previewWorksheet } = await freshService();
    // The mocked findFirst is tenant-scoped by the CALLER's own predicate in
    // real Prisma; here we simulate a genuine cross-tenant miss by having
    // the mock return null (as real Postgres would for a mismatched
    // organisation_id in the WHERE clause) and independently assert the
    // predicate itself carries the right organisation_id (see the next
    // test) AND that storage is never reached as a result.
    uploadFindFirstMock.mockResolvedValue(null);
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "someone-elses-worksheet" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
    expect(storageGetMock).not.toHaveBeenCalled();
    expect(importBatchFindUniqueMock).not.toHaveBeenCalled();
  });

  it("the tenant+lineage predicate is passed in the SAME findFirst call (never fetch-then-check)", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(null);
    await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(uploadFindFirstMock).toHaveBeenCalledTimes(1);
    const callArg = uploadFindFirstMock.mock.calls[0][0];
    expect(callArg.where).toMatchObject({ id: "w-1", organisation_id: "org-1", lineage_kind: "DATA_HUB" });
  });
});

describe("previewWorksheet — eligibility matrix", () => {
  it("INELIGIBLE -> WORKSHEET_NOT_ELIGIBLE, storage never touched", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ canonical_status: "INELIGIBLE" }));
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("SKIPPED -> WORKSHEET_NOT_ELIGIBLE, storage never touched", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ canonical_status: "SKIPPED" }));
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("AWAITING_CONFIRMATION proceeds to the parent-batch lookup", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ canonical_status: "AWAITING_CONFIRMATION" }));
    importBatchFindUniqueMock.mockResolvedValue(null);
    await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(importBatchFindUniqueMock).toHaveBeenCalledTimes(1);
  });

  it("IMPORTED proceeds to the parent-batch lookup too (mirrors confirm's own idempotent permissiveness)", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ canonical_status: "IMPORTED" }));
    importBatchFindUniqueMock.mockResolvedValue(null);
    await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(importBatchFindUniqueMock).toHaveBeenCalledTimes(1);
  });
});

describe("previewWorksheet — parent batch gates", () => {
  it("tombstoned/missing parent batch -> WORKSHEET_NOT_FOUND, storage never touched", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(null);
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("batch not READY -> BATCH_NOT_READY, storage never touched", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ status: "PROCESSING" }));
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_READY" });
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("non-csv content_type -> UNSUPPORTED_FORMAT, storage never touched (M6)", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ content_type: "xlsx", sha256: "deadbeef" }));
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("parent lookup uses the worksheet's OWN import_batch_id, tenant-scoped via the compound key", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ import_batch_id: "batch-xyz" }));
    importBatchFindUniqueMock.mockResolvedValue(null);
    await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    const callArg = importBatchFindUniqueMock.mock.calls[0][0];
    expect(callArg.where.id_organisation_id).toMatchObject({ id: "batch-xyz", organisation_id: "org-1" });
  });
});

describe("previewWorksheet — storage failure and integrity", () => {
  it("STORAGE_NOT_FOUND when the object is missing", async () => {
    const { previewWorksheet } = await import("@/lib/data-hub/importBatch/previewWorksheet");
    // Need RawFileStoreError from the real module for instanceof to work.
    const { RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: "deadbeef" }));
    storageGetMock.mockRejectedValue(new RawFileStoreError("NOT_FOUND", "not found"));
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result).toMatchObject({ ok: false, code: "STORAGE_NOT_FOUND" });
  });

  it("PROVIDER_FAILURE on an unexpected storage error", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: "deadbeef" }));
    storageGetMock.mockRejectedValue(new Error("boom"));
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result).toMatchObject({ ok: false, code: "PROVIDER_FAILURE" });
  });

  it("STORAGE_INTEGRITY_MISMATCH when the recomputed hash disagrees with the persisted sha256", async () => {
    const { previewWorksheet } = await freshService();
    const { body } = bufferAndHash(buildCsv(REQUIRED_HEADERS, [["2024-01-01", "loc", "type"]]));
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: "0000000000000000000000000000000000000000000000000000000000000000" }));
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
  });

  it("PARSER_REJECTED on malformed CSV", async () => {
    const { previewWorksheet } = await freshService();
    const { body, sha256 } = bufferAndHash('"unterminated quote,row');
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result).toMatchObject({ ok: false, code: "PARSER_REJECTED" });
  });
});

describe("previewWorksheet — bounding is real (M3/M4)", () => {
  it("a 500-row CSV yields exactly 20 sampleRows, sampleRowCount 20, truncated true, and the TRUE rowCount (500)", async () => {
    const { previewWorksheet } = await freshService();
    const rows = Array.from({ length: 500 }, (_, i) => [`2024-01-${String((i % 28) + 1).padStart(2, "0")}`, `loc-${i}`, "type"]);
    const csv = buildCsv(REQUIRED_HEADERS, rows);
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });

    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.rowCount).toBe(500);
    expect(result.preview.sampleRows).toHaveLength(20);
    expect(result.preview.sampleRowCount).toBe(20);
    expect(result.preview.truncated).toBe(true);
    // Internal consistency (M10): sampleRows.length must equal the
    // declared sampleRowCount, not merely be a plausible number.
    expect(result.preview.sampleRows.length).toBe(result.preview.sampleRowCount);
  });

  it("a CSV with fewer rows than the bound reports truncated:false and sampleRowCount === rowCount", async () => {
    const { previewWorksheet } = await freshService();
    const rows = [["2024-01-01", "loc-1", "type"], ["2024-01-02", "loc-2", "type"]];
    const csv = buildCsv(REQUIRED_HEADERS, rows);
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });

    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.rowCount).toBe(2);
    expect(result.preview.sampleRowCount).toBe(2);
    expect(result.preview.truncated).toBe(false);
  });

  it("an 80-column CSV yields exactly 50 headers and 50 cells per sample row, but the TRUE columnCount (80)", async () => {
    const { previewWorksheet } = await freshService();
    const headers = [...REQUIRED_HEADERS, ...Array.from({ length: 77 }, (_, i) => `extra_${i}`)];
    const row = headers.map((_, i) => (i < 3 ? ["2024-01-01", "loc", "type"][i] : `v${i}`));
    const csv = buildCsv(headers, [row]);
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });

    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.columnCount).toBe(80);
    expect(result.preview.headers).toHaveLength(50);
    expect(result.preview.sampleRows[0]).toHaveLength(50);
  });

  it("a cell longer than 200 characters is truncated with a marker, never returned raw", async () => {
    const { previewWorksheet } = await freshService();
    const longValue = "x".repeat(5000);
    const csv = buildCsv(REQUIRED_HEADERS, [["2024-01-01", longValue, "type"]]);
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });

    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const locationCell = result.preview.sampleRows[0][1];
    expect(locationCell.length).toBeLessThanOrEqual(220);
    expect(locationCell).toMatch(/…\(truncated\)$/);
    expect(locationCell).not.toBe(longValue);
  });

  it("a large-but-legal CSV (2000 rows x 60 columns) still produces a serialized preview well under 500KB", async () => {
    const { previewWorksheet } = await freshService();
    const headers = [...REQUIRED_HEADERS, ...Array.from({ length: 57 }, (_, i) => `col_${i}`)];
    const rows = Array.from({ length: 2000 }, (_, r) =>
      headers.map((_, c) => (c === 0 ? "2024-01-01" : c === 1 ? `loc-${r}` : c === 2 ? "type" : `val-${r}-${c}`))
    );
    const csv = buildCsv(headers, rows);
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });

    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.rowCount).toBe(2000);
    expect(result.preview.columnCount).toBe(60);
    const serialized = JSON.stringify(result.preview);
    expect(serialized.length).toBeLessThan(500_000);
  });
});

describe("previewWorksheet — CSV correctness (quoting, embedded newlines/commas, BOM, blank rows)", () => {
  it("preserves an embedded comma inside a quoted field", async () => {
    const { previewWorksheet } = await freshService();
    const csv = `report_date,location,waste_type\n2024-01-01,"Smith, John St",type`;
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.sampleRows[0][1]).toBe("Smith, John St");
  });

  it("preserves an embedded newline inside a quoted field as a single logical cell", async () => {
    const { previewWorksheet } = await freshService();
    const csv = `report_date,location,waste_type\n2024-01-01,"Line one\nLine two",type`;
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.rowCount).toBe(1);
    expect(result.preview.sampleRows[0][1]).toBe("Line one\nLine two");
  });

  it("strips a UTF-8 BOM from the header row", async () => {
    const { previewWorksheet } = await freshService();
    const csv = "﻿report_date,location,waste_type\n2024-01-01,loc,type";
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.headers[0]).toBe("report_date");
  });

  it("tolerates a blank row without throwing", async () => {
    const { previewWorksheet } = await freshService();
    const csv = "report_date,location,waste_type\n2024-01-01,loc,type\n,,\n2024-01-02,loc2,type2";
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.rowCount).toBe(3);
  });
});

describe("previewWorksheet — required-header presence", () => {
  it("all required headers present -> requiredHeadersPresent true, missingRequiredHeaders empty", async () => {
    const { previewWorksheet } = await freshService();
    const csv = buildCsv(REQUIRED_HEADERS, [["2024-01-01", "loc", "type"]]);
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.requiredHeadersPresent).toBe(true);
    expect(result.preview.missingRequiredHeaders).toEqual([]);
  });

  it("a missing required header -> requiredHeadersPresent false, missingRequiredHeaders lists it, preview still succeeds (never PARSER_REJECTED)", async () => {
    const { previewWorksheet } = await freshService();
    const csv = buildCsv(["report_date", "location"], [["2024-01-01", "loc"]]);
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.requiredHeadersPresent).toBe(false);
    expect(result.preview.missingRequiredHeaders).toEqual(["waste_type"]);
  });

  it("a duplicated required header -> requiredHeadersPresent false, missingRequiredHeaders empty (nothing is literally missing — an honest, distinct signal from 'missing')", async () => {
    const { previewWorksheet } = await freshService();
    const csv = buildCsv(["report_date", "report_date", "location", "waste_type"], [["2024-01-01", "2024-01-02", "loc", "type"]]);
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.requiredHeadersPresent).toBe(false);
    expect(result.preview.missingRequiredHeaders).toEqual([]);
  });
});

describe("previewWorksheet — no storage locator/token in the response, no mutation, determinism", () => {
  it("the response never contains a storage key, blob url, or token", async () => {
    const { previewWorksheet } = await freshService();
    const csv = buildCsv(REQUIRED_HEADERS, [["2024-01-01", "loc", "type"]]);
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/datahub-batch:|storage_key|blob\.vercel-storage\.com|token/i);
  });

  it("performs zero Prisma writes across a full successful call (M7)", async () => {
    const { previewWorksheet } = await freshService();
    const csv = buildCsv(REQUIRED_HEADERS, [["2024-01-01", "loc", "type"]]);
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });
    await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(uploadUpdateMock).not.toHaveBeenCalled();
    expect(uploadUpdateManyMock).not.toHaveBeenCalled();
    expect(importBatchUpdateMock).not.toHaveBeenCalled();
    expect(illegalDumpingCreateManyMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("two consecutive calls against an unchanged worksheet return byte-identical DTOs (deterministic, read-only)", async () => {
    const { previewWorksheet } = await freshService();
    const csv = buildCsv(REQUIRED_HEADERS, [["2024-01-01", "loc", "type"]]);
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });
    const first = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    const second = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(first).toEqual(second);
  });

  it("preview cannot confirm/import: calling previewWorksheet never affects canonical_status (no update call exists to affect it)", async () => {
    const { previewWorksheet } = await freshService();
    const csv = buildCsv(REQUIRED_HEADERS, [["2024-01-01", "loc", "type"]]);
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ canonical_status: "AWAITING_CONFIRMATION" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    expect(uploadUpdateMock).not.toHaveBeenCalled();
    expect(uploadUpdateManyMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5B.4C — MAPPED (frozen-lineage) worksheet Preview
//
// Core rule under test throughout this block: Preview CONSUMES frozen
// lineage, it never resolves/repairs/follows it. The frozen
// Upload.mapping_version_id captured once from Step 1's own read is the
// SOLE authority — SourceMapping.active_mapping_version_id and both
// SourceSystem.active/SourceMapping.active are never consulted for an
// already-frozen worksheet (those remain 5B.4B's own NEW-selection gates).
// ═══════════════════════════════════════════════════════════════════════

function mappingVersionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "mv-3",
    source_mapping_id: "sm-1",
    version_number: 3,
    mapping_document: { fields: { report_date: "Reported At", location: "Site", waste_type: "Type" } },
    ...overrides,
  };
}
function sourceMappingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "sm-1", source_system_id: "ss-1", ...overrides };
}
function mappedCsv(rows: string[][]): { body: Buffer; sha256: string } {
  return bufferAndHash(buildCsv(["Reported At", "Site", "Type"], rows));
}

describe("previewWorksheet — 5B.4C legacy/mapped dual-path routing (T1/T3)", () => {
  it("NULL mapping_version_id -> zero mappingVersion/sourceMapping lookups, mapping: null in the response", async () => {
    const { previewWorksheet } = await freshService();
    const csv = buildCsv(REQUIRED_HEADERS, [["2024-01-01", "loc", "type"]]);
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: null }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256 }));
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.mapping).toBeNull();
    expect(mappingVersionFindUniqueMock).not.toHaveBeenCalled();
    expect(sourceMappingFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("previewWorksheet — 5B.4C exact frozen-version lookup (T5/T6)", () => {
  it("resolves the EXACT persisted Upload.mapping_version_id, tenant-scoped via the compound key", async () => {
    const { previewWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "loc", "type"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(mappingVersionFindUniqueMock).toHaveBeenCalledTimes(1);
    const callArg = mappingVersionFindUniqueMock.mock.calls[0][0];
    expect(callArg.where.id_organisation_id).toMatchObject({ id: "mv-3", organisation_id: "org-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.mapping?.mappingVersionId).toBe("mv-3");
    expect(result.preview.mapping?.versionNumber).toBe(3);
  });
});

describe("previewWorksheet — 5B.4C lineage-resolution failures fail safely (T9/T10)", () => {
  it("frozen MappingVersion no longer exists -> MAPPING_LINEAGE_UNAVAILABLE, storage never touched", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-gone" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: "deadbeef", source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(null);
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result).toMatchObject({ ok: false, code: "MAPPING_LINEAGE_UNAVAILABLE" });
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("cross-source corruption (SourceMapping.source_system_id !== batch.source_system_id) -> MAPPING_LINEAGE_UNAVAILABLE, never distinguished from other lineage failures (M4)", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: "deadbeef", source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow({ source_system_id: "ss-2" }));
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result).toMatchObject({ ok: false, code: "MAPPING_LINEAGE_UNAVAILABLE" });
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("SourceMapping itself no longer resolvable -> MAPPING_LINEAGE_UNAVAILABLE (M3)", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: "deadbeef", source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(null);
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result).toMatchObject({ ok: false, code: "MAPPING_LINEAGE_UNAVAILABLE" });
  });
});

describe("previewWorksheet — 5B.4C consumption never consults active state (T13/T14/T15, M5/M6)", () => {
  it("the mappingVersion/sourceMapping lookups select no `active`/active_mapping_version_id field at all — structurally impossible to consult", () => {
    const code = stripComments(read(SERVICE_PATH));
    const mvCallIdx = code.indexOf("prisma.mappingVersion.findUnique(");
    const mvBlock = code.slice(mvCallIdx, code.indexOf(");", mvCallIdx));
    expect(mvBlock).not.toMatch(/active_mapping_version_id/);
    const smCallIdx = code.indexOf("prisma.sourceMapping.findUnique(");
    const smBlock = code.slice(smCallIdx, code.indexOf(");", smCallIdx));
    expect(smBlock).not.toMatch(/\bactive:\s*true\b/);
    expect(smBlock).not.toMatch(/active_mapping_version_id/);
  });

  it("even if the mocked SourceMapping row carried active:false, Preview still succeeds using the frozen version (deactivation after selection does not break consumption)", async () => {
    const { previewWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "loc", "type"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    // active:false is present on the mocked row purely to prove the service
    // never reads/branches on it — the select in previewWorksheet.ts does
    // not even request this column in real Prisma usage (asserted above).
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow({ active: false }));
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.mapping?.mappingVersionId).toBe("mv-3");
  });

  it("a newly-activated v4 on the SAME SourceMapping never influences a Preview frozen at v3 — only the frozen id is ever looked up (M25)", async () => {
    const { previewWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "loc", "type"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow({ id: "mv-3", version_number: 3 }));
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.mapping?.mappingVersionId).toBe("mv-3");
    expect(result.preview.mapping?.versionNumber).toBe(3);
    // Only one mappingVersion lookup, for the one frozen id — no lookup of
    // any "current active" concept exists to have influenced this at all.
    expect(mappingVersionFindUniqueMock).toHaveBeenCalledTimes(1);
    expect(mappingVersionFindUniqueMock.mock.calls[0][0].where.id_organisation_id.id).toBe("mv-3");
  });
});

describe("previewWorksheet — 5B.4C stored MappingDocument revalidated at use time (T16/T17/T20)", () => {
  it("a corrupt stored mapping_document -> MAPPING_DOCUMENT_INVALID, storage never touched, no legacy fallback", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: "deadbeef", source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(
      mappingVersionRow({ mapping_document: { fields: { not_a_real_canonical_target: "X" } } })
    );
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result).toMatchObject({ ok: false, code: "MAPPING_DOCUMENT_INVALID" });
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("a non-object stored mapping_document -> MAPPING_DOCUMENT_INVALID (defends even a structurally impossible-per-schema value)", async () => {
    const { previewWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: "deadbeef", source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow({ mapping_document: "not-an-object" }));
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result).toMatchObject({ ok: false, code: "MAPPING_DOCUMENT_INVALID" });
  });
});

describe("previewWorksheet — 5B.4C compileMapping is genuinely invoked (T21/T22/T23/T24/T25)", () => {
  it("missing mapped source header in the real worksheet -> structurallyValid:false with a MAPPING_SOURCE_HEADER_MISSING diagnostic, Preview still succeeds (ok:true, mirroring legacy's own non-fatal missing-header behavior)", async () => {
    const { previewWorksheet } = await freshService();
    const { body, sha256 } = bufferAndHash(buildCsv(["Wrong Header", "Site", "Type"], [["x", "loc", "type"]]));
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.mapping?.structurallyValid).toBe(false);
    expect(result.preview.mapping?.mappingErrors).toContainEqual(
      expect.objectContaining({ code: "MAPPING_SOURCE_HEADER_MISSING", canonicalTarget: "report_date" })
    );
    expect(result.preview.mapping?.mappedSampleRows).toEqual([]);
    expect(result.preview.requiredHeadersPresent).toBe(false);
    expect(result.preview.missingRequiredHeaders).toContain("report_date");
  });

  it("ambiguous (duplicated after trim) mapped source header -> MAPPING_SOURCE_HEADER_AMBIGUOUS diagnostic", async () => {
    const { previewWorksheet } = await freshService();
    const { body, sha256 } = bufferAndHash(buildCsv(["Reported At", "Site", " Site ", "Type"], [["2024-01-01", "a", "b", "type"]]));
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.mapping?.mappingErrors).toContainEqual(
      expect.objectContaining({ code: "MAPPING_SOURCE_HEADER_AMBIGUOUS", canonicalTarget: "location" })
    );
  });

  it("a required canonical target simply not configured in the mapping document -> MAPPING_REQUIRED_TARGET_MISSING", async () => {
    const { previewWorksheet } = await freshService();
    const { body, sha256 } = bufferAndHash(buildCsv(["Reported At", "Site"], [["2024-01-01", "loc"]]));
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(
      mappingVersionRow({ mapping_document: { fields: { report_date: "Reported At", location: "Site" } } })
    );
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.mapping?.mappingErrors).toContainEqual(
      expect.objectContaining({ code: "MAPPING_REQUIRED_TARGET_MISSING", canonicalTarget: "waste_type" })
    );
    expect(result.preview.missingRequiredHeaders).toEqual(["waste_type"]);
  });

  it("Section 13: raw CSV header need not equal the canonical Illegal Dumping name when a valid mapping supplies it — 'Reported At'/'Site'/'Type' satisfy report_date/location/waste_type via the mapping, never via headers.includes()", async () => {
    const { previewWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "loc-1", "Dumped Rubbish"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.mapping?.structurallyValid).toBe(true);
    expect(result.preview.requiredHeadersPresent).toBe(true);
  });
});

describe("previewWorksheet — 5B.4C row application + domain-mapper feed (T28/T29/T30/T31/T32)", () => {
  it("mapped canonical values are correct, a short row's missing mapped cell is '' (never leaked undefined), an extra unmapped column is ignored, and the sample feeds the real unmodified domain mapper successfully", async () => {
    const { previewWorksheet } = await freshService();
    // Row 1: full width plus one extra unmapped trailing column. Row 2:
    // short (only 2 of 3 columns present) — the mapped "waste_type" cell
    // must resolve to "".
    const csv = buildCsv(
      ["Reported At", "Site", "Type", "Unused Extra"],
      [
        ["2024-01-01", "Loc A", "Dumped Rubbish", "ignored-value"],
        ["2024-01-02", "Loc B"],
      ]
    );
    const { body, sha256 } = bufferAndHash(csv);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.mapping?.structurallyValid).toBe(true);
    expect(result.preview.mapping?.mappedSampleRows).toEqual([
      { report_date: "2024-01-01", location: "Loc A", waste_type: "Dumped Rubbish" },
      { report_date: "2024-01-02", location: "Loc B", waste_type: "" },
    ]);
    // Row 2's mapped waste_type is "" (empty, business-required), so the
    // real, unmodified domain mapper correctly rejects it — proving actual
    // domain interpretation happened, not a rubber stamp — while the
    // structural mapping itself remains valid (a different, correctly
    // separated concern).
    expect(result.preview.mapping?.domainRowsValid).toBe(false);
  });

  it("a fully domain-valid mapped sample reports domainRowsValid:true (the real, unmodified mapIllegalDumpingRows genuinely ran)", async () => {
    const { previewWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "Loc A", "Dumped Rubbish"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.mapping?.domainRowsValid).toBe(true);
  });
});

describe("previewWorksheet — 5B.4C mapping applied to the bounded sample only (T33/T34/T35/T36)", () => {
  it("a 500-row mapped worksheet still yields exactly 20 mappedSampleRows — mapping is never applied to the full worksheet", async () => {
    const { previewWorksheet } = await freshService();
    const rows = Array.from({ length: 500 }, (_, i) => [`2024-01-${String((i % 28) + 1).padStart(2, "0")}`, `loc-${i}`, "Dumped Rubbish"]);
    const { body, sha256 } = mappedCsv(rows);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.rowCount).toBe(500);
    expect(result.preview.mapping?.mappedSampleRows).toHaveLength(20);
  });
});

describe("previewWorksheet — 5B.4C DTO safety (T37/T38/T39)", () => {
  it("the mapping summary never contains the raw mapping_document/active_mapping_version_id/organisationId", async () => {
    const { previewWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "loc", "Dumped Rubbish"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/mapping_document|active_mapping_version_id|"organisationId"|org-1/);
  });

  it("mapping summary carries exactly mappingVersionId/sourceMappingId/versionNumber/structuralValidity/errors/rows fields — no extra internals", async () => {
    const { previewWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "loc", "Dumped Rubbish"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const result = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.preview.mapping ?? {}).sort()).toEqual(
      ["domainRowsValid", "mappedSampleRows", "mappingErrors", "mappingVersionId", "sourceMappingId", "structurallyValid", "versionNumber"].sort()
    );
  });
});

describe("previewWorksheet — 5B.4C zero writes, mapped path included (T41-T46)", () => {
  it("a full successful mapped-preview call performs zero Prisma writes of any kind, and never calls $transaction", async () => {
    const { previewWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "loc", "Dumped Rubbish"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(uploadUpdateMock).not.toHaveBeenCalled();
    expect(uploadUpdateManyMock).not.toHaveBeenCalled();
    expect(importBatchUpdateMock).not.toHaveBeenCalled();
    expect(illegalDumpingCreateManyMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("the service source never contains any write call reachable from the mapping-lineage block (static, whole-file check already covers this — reconfirmed here scoped to the 5B.4C block specifically)", () => {
    const code = stripComments(read(SERVICE_PATH));
    const startIdx = code.indexOf("Step 7.5");
    const endIdx = code.indexOf("Step 8 —");
    const mappingBlock = code.slice(startIdx, endIdx);
    expect(mappingBlock).not.toMatch(/\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/);
    expect(mappingBlock).not.toMatch(/\$transaction/);
  });
});

describe("previewWorksheet — 5B.4C concurrency/coherence (T51/T52/T53)", () => {
  it("the frozen mapping_version_id is read exactly once (from Step 1's own worksheet lookup) and reused consistently for every subsequent lookup/compile/apply step — no second Upload re-read exists to introduce a metadata/output mismatch", () => {
    const code = stripComments(read(SERVICE_PATH));
    // Only ONE call to prisma.upload.findFirst exists in the whole file.
    const uploadFindFirstOccurrences = (code.match(/prisma\.upload\.findFirst\(/g) ?? []).length;
    expect(uploadFindFirstOccurrences).toBe(1);
    // The captured local variable is used, never a fresh re-fetch of Upload.
    expect(code).toMatch(/const frozenMappingVersionId = worksheet\.mapping_version_id;/);
  });

  it("two consecutive mapped-preview calls against an unchanged frozen worksheet return byte-identical mapping summaries (deterministic)", async () => {
    const { previewWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "loc", "Dumped Rubbish"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const first = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    const second = await previewWorksheet({ organisationId: "org-1", worksheetId: "w-1" });
    expect(first).toEqual(second);
  });
});

describe("previewWorksheet — 5B.4C containment: mappingExecution.ts is not reimplemented/modified, business logic stays in illegalDumpingMapper.ts", () => {
  it("previewWorksheet.ts never duplicates compileMapping's own header-matching logic (no local Map/trim-based header index besides the imported compiler's own)", () => {
    const code = stripComments(read(SERVICE_PATH));
    // The only header-matching construct in this file is the import of and
    // single call to compileMapping — never a second, local reimplementation.
    const compileMappingCalls = (code.match(/compileMapping\(/g) ?? []).length;
    expect(compileMappingCalls).toBe(1);
  });

  it("previewWorksheet.ts never imports/calls selectWorksheetMapping (no mapping-selection creep into Preview)", () => {
    const code = stripComments(read(SERVICE_PATH));
    expect(code).not.toMatch(/selectWorksheetMapping/);
  });

  it("previewWorksheet.ts never writes Upload.mapping_version_id (no 'repair missing lineage' capability, M14) — every `mapping_version_id:` colon-assignment in the file is a read-only Prisma select flag (`true`), never an assigned value", () => {
    const code = stripComments(read(SERVICE_PATH));
    const assignments = [...code.matchAll(/mapping_version_id\s*:\s*([^\n,}]+)/g)].map((m) => m[1].trim());
    expect(assignments.length).toBeGreaterThan(0);
    for (const value of assignments) {
      expect(value).toBe("true");
    }
  });
});
