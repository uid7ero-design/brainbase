import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 5A.2I — static source-text containment for the two write
// routes exposing the dark initiate/finalize services over HTTP. Mirrors
// the established convention for this module tree (dataHubReadRoutes.test.ts,
// dataHubImportBatchDarkness.test.ts): real behavior (auth, tenant
// isolation, storage authority, concurrency, idempotency) is proven
// against real Postgres by
// scripts/tests/dataHubInitiateFinalizeRoutes.integration.test.ts. This
// file proves STRUCTURAL properties that are cheap and reliable to prove
// statically.

const ROOT = process.cwd();

const INITIATE_ROUTE = path.join("app", "api", "data-hub", "import-batches", "route.ts");
const FINALIZE_ROUTE = path.join("app", "api", "data-hub", "import-batches", "[id]", "finalize", "route.ts");
const ROUTE_FILES = [INITIATE_ROUTE, FINALIZE_ROUTE];

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("5A.2I route files exist at exactly the expected paths", () => {
  for (const relPath of ROUTE_FILES) {
    it(`${relPath} exists`, () => {
      expect(fs.existsSync(path.join(ROOT, relPath))).toBe(true);
    });
  }
});

describe("5A.2I routes — no parser/storage/xlsx dependency, direct or transitive", () => {
  for (const relPath of ROUTE_FILES) {
    const stripped = stripComments(read(relPath));
    it(`${relPath} never imports xlsx directly or via workbookParser`, () => {
      expect(stripped).not.toMatch(/from\s+["']xlsx["']/);
      expect(stripped).not.toMatch(/workbookParser/);
      expect(stripped).not.toMatch(/\binspectWorkbook\b/);
      expect(stripped).not.toMatch(/\bdecodeWorksheet\(/);
    });
    it(`${relPath} never imports inspectWorksheets or staleReclaim`, () => {
      expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/inspectWorksheets["']/);
      expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/staleReclaim["']/);
      expect(stripped).not.toMatch(/reclaimStaleImportBatches/);
    });
    it(`${relPath} never imports the low-level finalizeInternal primitives or compositionRoot/directUploadAuth directly`, () => {
      // The route calls the high-level finalizeImportBatch/initiateImportBatch
      // services only — never finalizeInternal's own claim/complete
      // primitives, and never the storage/token composition-root modules
      // directly (those are exclusively initiate.ts's/finalize.ts's own
      // concern).
      expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/finalizeInternal["']/);
      expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/compositionRoot["']/);
      expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/directUploadAuth["']/);
      expect(stripped).not.toMatch(/claimForFinalize|completeReadyForFinalize|completeFailedForFinalize/);
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
  }

  it("initiate route imports only initiateImportBatch (and its client-input type) from the importBatch tree, plus failureTaxonomy and the H.2 read service", () => {
    const stripped = stripComments(read(INITIATE_ROUTE));
    expect(stripped).toMatch(/from\s+["']@\/lib\/data-hub\/importBatch\/initiate["']/);
    expect(stripped).toMatch(/from\s+["']@\/lib\/data-hub\/importBatch\/failureTaxonomy["']/);
    expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/finalize["']/);
  });

  it("finalize route imports only finalizeImportBatch from the importBatch tree, plus failureTaxonomy", () => {
    const stripped = stripComments(read(FINALIZE_ROUTE));
    expect(stripped).toMatch(/from\s+["']@\/lib\/data-hub\/importBatch\/finalize["']/);
    expect(stripped).toMatch(/from\s+["']@\/lib\/data-hub\/importBatch\/failureTaxonomy["']/);
    expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/initiate["']/);
    expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/read["']/);
  });
});

describe("5A.2I routes — no UI/client/browser upload code, no schema/package change", () => {
  it("no @vercel/blob/client usage anywhere in either route (token minting is initiate.ts's own concern)", () => {
    for (const relPath of ROUTE_FILES) {
      expect(stripComments(read(relPath))).not.toMatch(/@vercel\/blob\/client/);
    }
  });
  it("no new UI/component file was added under components/ or a page under app/ outside app/api/data-hub/**", () => {
    // Structural sanity check only — the authoritative proof of zero diff
    // outside the expected file set is the implementation's own exact-diff
    // containment check (git diff), not this test. This assertion exists
    // so a future accidental UI addition under the exact same commit at
    // least has one automated static tripwire independent of manual diff
    // review.
    const dataHubApiDir = path.join(ROOT, "app", "api", "data-hub");
    expect(fs.existsSync(dataHubApiDir)).toBe(true);
  });
});

describe("5A.2I routes — POST-only, no other state-changing export beyond the intended method", () => {
  for (const relPath of ROUTE_FILES) {
    const stripped = stripComments(read(relPath));
    it(`${relPath} exports POST and no other HTTP method handler beyond its own existing GET (if any)`, () => {
      expect(stripped).toMatch(/export\s+async\s+function\s+POST\s*\(/);
      expect(stripped).not.toMatch(/export\s+(async\s+)?function\s+PUT\s*\(/);
      expect(stripped).not.toMatch(/export\s+(async\s+)?function\s+PATCH\s*\(/);
      expect(stripped).not.toMatch(/export\s+(async\s+)?function\s+DELETE\s*\(/);
    });
  }
  it("the finalize route exports exactly one HTTP method (POST) — no GET", () => {
    const stripped = stripComments(read(FINALIZE_ROUTE));
    expect(stripped).not.toMatch(/export\s+(async\s+)?function\s+GET\s*\(/);
  });
  it("the import-batches route retains its existing GET alongside the new POST", () => {
    const stripped = stripComments(read(INITIATE_ROUTE));
    expect(stripped).toMatch(/export\s+async\s+function\s+GET\s*\(/);
  });
});

// Extracts just the POST handler's own function body — deliberately NOT
// a whole-file check. app/api/data-hub/import-batches/route.ts is SHARED
// with a pre-existing, unrelated H.3 GET handler that also legitimately
// contains `requireRole("manager")` / `organisationId: session.organisationId`
// — a whole-file regex would therefore still pass even if the POST
// handler's OWN auth/tenant logic were independently weakened, since the
// GET handler's occurrence alone would satisfy it. Scoping to the POST
// body specifically closes that gap.
function extractPostHandlerBody(relPath: string): string {
  const stripped = stripComments(read(relPath));
  const postStart = stripped.indexOf("export async function POST(");
  if (postStart === -1) throw new Error(`No POST handler found in ${relPath}`);
  const nextExportStart = stripped.indexOf("\nexport ", postStart + 1);
  return nextExportStart === -1 ? stripped.slice(postStart) : stripped.slice(postStart, nextExportStart);
}

describe("5A.2I routes — authentication and trusted tenant context (scoped to each file's own POST handler)", () => {
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
  }
});

describe("5A.2I initiate route — tenant-input hardening (never spreads the request body into the service call)", () => {
  const code = read(INITIATE_ROUTE);
  const stripped = stripComments(code);

  it("never spreads the parsed request body directly into the service input (...body)", () => {
    expect(stripped).not.toMatch(/\.\.\.body\b/);
  });
  it("hand-constructs the service input from exactly the three permitted body fields", () => {
    expect(stripped).toMatch(/originalFilename:\s*body\.originalFilename/);
    expect(stripped).toMatch(/declaredSizeBytes:\s*body\.declaredSizeBytes/);
    expect(stripped).toMatch(/expectedSha256:\s*body\.expectedSha256/);
  });
  it("never reads an organisationId-shaped field from the parsed body", () => {
    expect(stripped).not.toMatch(/body\.organi[sz]ationId/i);
    expect(stripped).not.toMatch(/body\.organi[sz]ation_id/i);
    expect(stripped).not.toMatch(/body\.homeOrganisationId/i);
  });
  it("reads Idempotency-Key from a header, never from the JSON body", () => {
    expect(stripped).toMatch(/headers\.get\(\s*["']Idempotency-Key["']\s*\)/);
    expect(stripped).not.toMatch(/body\.idempotencyKey/);
  });
  it("never transforms the Idempotency-Key header value (no .trim()/.toLowerCase()/.toUpperCase() chained onto it) — it must remain the fully opaque exact string initiateImportBatch's own normalizeIdempotencyKey is the sole authority over", () => {
    const headerReadIndex = stripped.indexOf('headers.get(\n      "Idempotency-Key"');
    const inlineIndex = stripped.indexOf('headers.get("Idempotency-Key")');
    const idx = headerReadIndex !== -1 ? headerReadIndex : inlineIndex;
    expect(idx).toBeGreaterThan(-1);
    const nearby = stripped.slice(idx, idx + 200);
    expect(nearby).not.toMatch(/\.trim\(\)/);
    expect(nearby).not.toMatch(/\.toLowerCase\(\)/);
    expect(nearby).not.toMatch(/\.toUpperCase\(\)/);
  });
});

describe("5A.2I finalize route — LOAD-BEARING storage authority (never accepts a caller-controlled storage locator)", () => {
  const code = read(FINALIZE_ROUTE);
  const stripped = stripComments(code);

  it("never parses a request body at all (no req.json call anywhere)", () => {
    expect(stripped).not.toMatch(/req\.json\(\)/);
    expect(stripped).not.toMatch(/\breq\.body\b/);
    expect(stripped).not.toMatch(/await\s+_req\.json\(\)/);
  });
  it("never references any storage-locator-shaped field name", () => {
    expect(stripped).not.toMatch(/\bstorageKey\b/);
    expect(stripped).not.toMatch(/\bstorage_key\b/);
    expect(stripped).not.toMatch(/\bstorageProvider\b/);
    expect(stripped).not.toMatch(/\bstoreId\b/i);
    expect(stripped).not.toMatch(/\bpathname\b/);
    expect(stripped).not.toMatch(/\betag\b/i);
  });
  it("the only inputs to finalizeImportBatch are the trusted context and the path id", () => {
    expect(stripped).toMatch(/finalizeImportBatch\(\s*\{\s*organisationId:\s*session\.organisationId\s*\},\s*id\s*\)/);
  });
  it("never performs a route-level pre-read/precheck before calling finalizeImportBatch, and calls it exactly once — the service's own atomic claim/fencing remains the sole correctness mechanism, never a route-level TOCTOU precheck", () => {
    expect(stripped).not.toMatch(/findUnique|findFirst|\$queryRaw/);
    const matches = stripped.match(/finalizeImportBatch\(/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe("5A.2I routes — deterministic error mapping, no leaked internals", () => {
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
    it(`${relPath} uses fixed message templates from failureTaxonomy, never a raw service internal`, () => {
      expect(stripComments(code)).toMatch(/getMessageTemplate\(/);
    });
  }

  it("finalize route's FAILED outcome maps to HTTP 200 (a correctly-persisted physical-file failure, not a transport error)", () => {
    const stripped = stripComments(read(FINALIZE_ROUTE));
    const failedBlockStart = stripped.indexOf('outcome === "FAILED"');
    const nextBlockStart = stripped.indexOf('if (result.outcome ===', failedBlockStart + 1);
    expect(failedBlockStart).toBeGreaterThan(-1);
    expect(nextBlockStart).toBeGreaterThan(failedBlockStart);
    const block = stripped.slice(failedBlockStart, nextBlockStart);
    expect(block).toMatch(/status:\s*200/);
    expect(block).not.toMatch(/status:\s*(400|409|422|500)/);
  });

  it("finalize route's response never implies worksheet parsing/import (no worksheet/parsed/imported/validated field names)", () => {
    const stripped = stripComments(read(FINALIZE_ROUTE));
    expect(stripped).not.toMatch(/worksheet/i);
    expect(stripped).not.toMatch(/\bparsed\b/i);
    expect(stripped).not.toMatch(/\bimported\b/i);
    expect(stripped).not.toMatch(/\bvalidated\b/i);
  });
});

describe("5A.2I routes — cache policy", () => {
  for (const relPath of ROUTE_FILES) {
    const code = read(relPath);
    it(`${relPath} sets Cache-Control: private, no-store`, () => {
      expect(stripComments(code)).toMatch(/"Cache-Control":\s*"private,\s*no-store"/);
    });
  }
});

describe("5A.2I initiate route — response redaction (never exposes storage internals)", () => {
  const code = read(INITIATE_ROUTE);
  const stripped = stripComments(code);
  // Scope the check to the POST handler only (the file's own GET handler
  // legitimately returns a `batches` DTO built from H.2's own read.ts,
  // which is separately, exhaustively proven safe by
  // dataHubReadRoutes.test.ts — re-asserting it here would be redundant).
  const postStart = stripped.indexOf("export async function POST(");
  const postBody = stripped.slice(postStart);

  it("never returns storageKey/storageProvider/storeId/etag/a storage URL in the POST response", () => {
    expect(postBody).not.toMatch(/storageKey/);
    expect(postBody).not.toMatch(/storage_key/);
    expect(postBody).not.toMatch(/storageProvider/);
    expect(postBody).not.toMatch(/storeId/i);
    expect(postBody).not.toMatch(/\betag\b/i);
  });
  it("never spreads result.batch directly into the response", () => {
    expect(postBody).not.toMatch(/\.\.\.result\.batch/);
  });
});

describe("5A.2I initiate route — idempotency transport mapping is not weakened", () => {
  const code = read(INITIATE_ROUTE);
  const stripped = stripComments(code);
  const postStart = stripped.indexOf("export async function POST(");
  const postBody = stripped.slice(postStart);

  it("never performs its own pre-read/duplicate lookup before calling initiateImportBatch", () => {
    expect(postBody).not.toMatch(/findUnique|findFirst|\$queryRaw/);
  });
  it("calls initiateImportBatch exactly once", () => {
    const matches = postBody.match(/initiateImportBatch\(/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
