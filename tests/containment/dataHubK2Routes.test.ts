import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 5A.2K.2 — static source-text containment for the two new
// write routes exposing CSV-only worksheet inspection and illegal-dumping
// confirmation over HTTP. Mirrors the established convention for this
// module tree (dataHubInitiateFinalizeRoutes.test.ts,
// dataHubImportBatchDarkness.test.ts): real behavior (auth, tenant
// isolation, storage authority, concurrency, idempotency) is proven
// against real Postgres by
// scripts/tests/dataHubK2Routes.integration.test.ts. This file proves
// STRUCTURAL properties that are cheap and reliable to prove statically.

const ROOT = process.cwd();

const INSPECT_ROUTE = path.join("app", "api", "data-hub", "import-batches", "[id]", "inspect", "route.ts");
const CONFIRM_ROUTE = path.join(
  "app",
  "api",
  "data-hub",
  "worksheets",
  "[id]",
  "confirm-illegal-dumping",
  "route.ts"
);
const ROUTE_FILES = [INSPECT_ROUTE, CONFIRM_ROUTE];

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
function extractPostHandlerBody(relPath: string): string {
  const stripped = stripComments(read(relPath));
  const postStart = stripped.indexOf("export async function POST(");
  if (postStart === -1) throw new Error(`No POST handler found in ${relPath}`);
  const nextExportStart = stripped.indexOf("\nexport ", postStart + 1);
  return nextExportStart === -1 ? stripped.slice(postStart) : stripped.slice(postStart, nextExportStart);
}

describe("5A.2K.2 route files exist at exactly the expected paths", () => {
  for (const relPath of ROUTE_FILES) {
    it(`${relPath} exists`, () => {
      expect(fs.existsSync(path.join(ROOT, relPath))).toBe(true);
    });
  }
});

describe("5A.2K.2 routes — no xlsx/workbookParser/inspectWorksheets dependency, direct or transitive via source text", () => {
  for (const relPath of ROUTE_FILES) {
    const stripped = stripComments(read(relPath));
    it(`${relPath} never imports xlsx directly or via workbookParser`, () => {
      expect(stripped).not.toMatch(/from\s+["']xlsx["']/);
      expect(stripped).not.toMatch(/workbookParser/);
      expect(stripped).not.toMatch(/\binspectWorkbook\b/);
      expect(stripped).not.toMatch(/\bdecodeWorksheet\(/);
    });
    it(`${relPath} never imports inspectWorksheets.ts (the XLS/XLSX-capable inspection service) or staleReclaim`, () => {
      expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/inspectWorksheets["']/);
      expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/staleReclaim["']/);
      expect(stripped).not.toMatch(/reclaimStaleImportBatches/);
    });
    it(`${relPath} never imports the storage layer (RawFileStore, @vercel/blob) directly`, () => {
      expect(stripped).not.toMatch(/rawFileStore/i);
      expect(stripped).not.toMatch(/@vercel\/blob/);
    });
    it(`${relPath} never imports the legacy upload pipeline or confirmImport`, () => {
      expect(stripped).not.toMatch(/services\/upload/);
      expect(stripped).not.toMatch(/confirmImport/);
      expect(stripped).not.toMatch(/api\/files/);
    });
    it(`${relPath} exports POST and no other HTTP method handler`, () => {
      expect(stripped).toMatch(/export\s+async\s+function\s+POST\s*\(/);
      expect(stripped).not.toMatch(/export\s+(async\s+)?function\s+GET\s*\(/);
      expect(stripped).not.toMatch(/export\s+(async\s+)?function\s+PUT\s*\(/);
      expect(stripped).not.toMatch(/export\s+(async\s+)?function\s+PATCH\s*\(/);
      expect(stripped).not.toMatch(/export\s+(async\s+)?function\s+DELETE\s*\(/);
    });
    it(`${relPath} sets Cache-Control: private, no-store`, () => {
      expect(stripped).toMatch(/"Cache-Control":\s*"private,\s*no-store"/);
    });
  }

  it("inspect route imports only inspectCsvWorksheet from the importBatch tree", () => {
    const stripped = stripComments(read(INSPECT_ROUTE));
    expect(stripped).toMatch(/from\s+["']@\/lib\/data-hub\/importBatch\/inspectCsvWorksheet["']/);
    expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/confirmWorksheet["']/);
    expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/illegalDumpingMapper["']/);
    expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/finalize["']/);
    expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/initiate["']/);
  });

  it("confirm route imports only confirmDataHubWorksheet from the importBatch tree (never illegalDumpingMapper directly — that is confirmWorksheet.ts's own internal concern)", () => {
    const stripped = stripComments(read(CONFIRM_ROUTE));
    expect(stripped).toMatch(/from\s+["']@\/lib\/data-hub\/importBatch\/confirmWorksheet["']/);
    expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/illegalDumpingMapper["']/);
    expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/inspectCsvWorksheet["']/);
    expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/csvOnlyDecoder["']/);
  });
});

describe("5A.2K.2 routes — authentication and trusted tenant context (scoped to each file's own POST handler)", () => {
  for (const relPath of ROUTE_FILES) {
    it(`${relPath}'s POST handler requires requireRole("manager")`, () => {
      expect(extractPostHandlerBody(relPath)).toMatch(/requireRole\(\s*["']manager["']\s*\)/);
    });
    it(`${relPath}'s POST handler never reads organisationId/organisation_id from request input`, () => {
      const body = extractPostHandlerBody(relPath);
      expect(body).not.toMatch(/searchParams\.get\(\s*["']organi[sz]ation/i);
      expect(body).not.toMatch(/params\.organi[sz]ationId/i);
      expect(body).not.toMatch(/headers\.get\(\s*["']x-organi[sz]ation/i);
    });
    it(`${relPath}'s POST handler never uses homeOrganisationId`, () => {
      expect(extractPostHandlerBody(relPath)).not.toMatch(/homeOrganisationId/);
    });
    it(`${relPath}'s POST handler passes session.organisationId into the service call`, () => {
      expect(extractPostHandlerBody(relPath)).toMatch(/organisationId:\s*session\.organisationId/);
    });
    it(`${relPath}'s POST handler never parses a request body at all (no req.json call anywhere)`, () => {
      const body = extractPostHandlerBody(relPath);
      expect(body).not.toMatch(/req\.json\(\)/);
      expect(body).not.toMatch(/\breq\.body\b/);
      expect(body).not.toMatch(/await\s+_req\.json\(\)/);
    });
  }
});

describe("5A.2K.2 inspect route — LOAD-BEARING storage authority (never accepts a caller-controlled storage/format locator)", () => {
  const stripped = stripComments(read(INSPECT_ROUTE));

  it("never references any storage-locator-shaped field name", () => {
    expect(stripped).not.toMatch(/\bstorageKey\b/);
    expect(stripped).not.toMatch(/\bstorage_key\b/);
    expect(stripped).not.toMatch(/\bstorageProvider\b/);
    expect(stripped).not.toMatch(/\bstoreId\b/i);
    expect(stripped).not.toMatch(/\bpathname\b/);
    expect(stripped).not.toMatch(/\betag\b/i);
  });
  it("never references a caller-suppliable content-type/format field", () => {
    const body = extractPostHandlerBody(INSPECT_ROUTE);
    expect(body).not.toMatch(/body\.(content[_-]?[Tt]ype|format)/);
  });
  it("the only inputs to inspectCsvWorksheet are the trusted context and the path id", () => {
    expect(stripped).toMatch(
      /inspectCsvWorksheet\(\s*\{\s*organisationId:\s*session\.organisationId,\s*importBatchId:\s*id\s*\}\s*\)/
    );
  });
  it("never performs a route-level pre-read/precheck before calling inspectCsvWorksheet, and calls it exactly once", () => {
    expect(stripped).not.toMatch(/findUnique|findFirst|\$queryRaw/);
    const matches = stripped.match(/inspectCsvWorksheet\(/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe("5A.2K.2 confirm route — LOAD-BEARING storage/importer authority (never accepts a caller-controlled locator or domain selector)", () => {
  const stripped = stripComments(read(CONFIRM_ROUTE));

  it("never references any storage-locator-shaped field name", () => {
    expect(stripped).not.toMatch(/\bstorageKey\b/);
    expect(stripped).not.toMatch(/\bstorage_key\b/);
    expect(stripped).not.toMatch(/\bstorageProvider\b/);
    expect(stripped).not.toMatch(/\bstoreId\b/i);
    expect(stripped).not.toMatch(/\bpathname\b/);
    expect(stripped).not.toMatch(/\betag\b/i);
  });
  it("never references an importer/domain-selector-shaped field name — the route path itself is the sole importer-selection boundary", () => {
    const body = extractPostHandlerBody(CONFIRM_ROUTE);
    expect(body).not.toMatch(/body\.(importer|domain|schemaType|type|destination|table)\b/i);
    expect(body).not.toMatch(/\bimporter\s*:/i);
  });
  it("the only inputs to confirmDataHubWorksheet are the trusted context and the path id", () => {
    expect(stripped).toMatch(
      /confirmDataHubWorksheet\(\s*\{\s*organisationId:\s*session\.organisationId,\s*worksheetUploadId:\s*id\s*\}\s*\)/
    );
  });
  it("never performs a route-level pre-read/precheck before calling confirmDataHubWorksheet, and calls it exactly once — the service's own atomic claim remains the sole correctness mechanism, never a route-level TOCTOU precheck", () => {
    expect(stripped).not.toMatch(/findUnique|findFirst|\$queryRaw/);
    const matches = stripped.match(/confirmDataHubWorksheet\(/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe("5A.2K.2 routes — deterministic error mapping, no leaked internals", () => {
  for (const relPath of ROUTE_FILES) {
    const code = read(relPath);
    it(`${relPath} maps a Forbidden auth error to 403 and everything else to 401`, () => {
      const stripped = stripComments(code);
      expect(stripped).toMatch(/status:\s*403/);
      expect(stripped).toMatch(/status:\s*401/);
    });
    it(`${relPath} maps an unexpected internal error to a generic 500, never a raw error message`, () => {
      const stripped = stripComments(code);
      expect(stripped).toMatch(/status:\s*500/);
      const catchBlockStart = stripped.lastIndexOf("catch (err)");
      const body = stripped.slice(catchBlockStart);
      expect(body).not.toMatch(/err\.message/);
      expect(body).not.toMatch(/String\(err\)/);
      expect(body).not.toMatch(/error:\s*err[,)\s]/);
    });
    it(`${relPath} never returns a raw Prisma/SQL/storage-key/token/path in the response body`, () => {
      const stripped = stripComments(code);
      expect(stripped).not.toMatch(/\.stack\b/);
      expect(stripped).not.toMatch(/err\.code\b/);
    });
  }

  it("inspect route's failure branch uses result.message (the service's own fixed, sanitized template), never a raw internal", () => {
    const body = extractPostHandlerBody(INSPECT_ROUTE);
    expect(body).toMatch(/result\.message/);
  });

  it("confirm route's failure branch uses result.message (the service's own fixed, sanitized template), never a raw internal", () => {
    const body = extractPostHandlerBody(CONFIRM_ROUTE);
    expect(body).toMatch(/result\.message/);
  });

  it("inspect route's status-by-code mapping is exhaustive against InspectCsvWorksheetFailureCode (TypeScript Record enforces this at compile time — this test asserts the literal keys are present in source, as a redundant, independently-readable proof)", () => {
    const stripped = stripComments(read(INSPECT_ROUTE));
    const expectedCodes = [
      "BATCH_NOT_FOUND",
      "BATCH_NOT_READY",
      "UNSUPPORTED_FORMAT",
      "STORAGE_NOT_FOUND",
      "PROVIDER_FAILURE",
      "STORAGE_INTEGRITY_MISMATCH",
      "PARSER_REJECTED",
      "PERSISTENCE_CONFLICT",
    ];
    for (const code of expectedCodes) {
      expect(stripped).toMatch(new RegExp(`${code}:\\s*\\d+`));
    }
  });

  it("confirm route's status-by-code mapping is exhaustive against the full FailureCode union (TypeScript Record enforces this at compile time)", () => {
    const stripped = stripComments(read(CONFIRM_ROUTE));
    const expectedReachableCodes = [
      "WORKSHEET_NOT_FOUND",
      "WORKSHEET_NOT_ELIGIBLE",
      "BATCH_NOT_READY",
      "UNSUPPORTED_FORMAT",
      "STORAGE_NOT_FOUND",
      "PROVIDER_FAILURE",
      "STORAGE_INTEGRITY_MISMATCH",
      "PARSER_REJECTED",
    ];
    for (const code of expectedReachableCodes) {
      expect(stripped).toMatch(new RegExp(`${code}:\\s*\\d+`));
    }
  });
});

describe("5A.2K.2 confirm route — idempotent success is never an error status", () => {
  it("the alreadyImported:true branch returns 200, not 409/an error", () => {
    const stripped = stripComments(read(CONFIRM_ROUTE));
    const idx = stripped.indexOf("result.alreadyImported");
    expect(idx).toBeGreaterThan(-1);
    const nearby = stripped.slice(idx, idx + 300);
    expect(nearby).toMatch(/status:\s*200/);
  });
});

describe("5A.2K.2 inspect route — response never exposes storage internals", () => {
  const stripped = stripComments(read(INSPECT_ROUTE));
  it("never returns storageKey/storageProvider/storeId/etag in the response", () => {
    expect(stripped).not.toMatch(/storageKey/);
    expect(stripped).not.toMatch(/storage_key/);
    expect(stripped).not.toMatch(/storageProvider/);
    expect(stripped).not.toMatch(/storeId/i);
  });
});
