import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 5A.2H.3 — static source-text containment for the four
// read-only GET routes exposing lib/data-hub/importBatch/read.ts over
// HTTP. Mirrors the established convention for this module tree
// (worksheetReadService.test.ts, dataHubImportBatchDarkness.test.ts):
// real behavior (auth, tenant isolation, lineage isolation, tombstones,
// pagination) is proven against real Postgres by
// scripts/tests/dataHubReadRoutes.integration.test.ts. This file proves
// STRUCTURAL properties — import discipline, exported HTTP method shape,
// and the presence of the required tenant-context/cache-header source
// text — that are cheap and reliable to prove statically.

const ROOT = process.cwd();

const ROUTE_FILES = [
  path.join("app", "api", "data-hub", "import-batches", "route.ts"),
  path.join("app", "api", "data-hub", "import-batches", "[id]", "route.ts"),
  path.join("app", "api", "data-hub", "import-batches", "[id]", "worksheets", "route.ts"),
  path.join("app", "api", "data-hub", "worksheets", "[id]", "route.ts"),
];

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Slices out exactly one exported handler's own body — from its
// `export async function <NAME>(` declaration up to (but not including)
// the next top-level `export` statement (or end of file, for the last
// handler). This is the SAME extraction pattern already used below for
// the GET-body-parsing check; it exists as a shared helper specifically
// so a per-handler auth/tenant-context assertion can be scoped to one
// handler's own executable body rather than the whole file — a
// whole-file `stripComments(code).toMatch(...)` check is satisfiable by
// an UNRELATED sibling handler in the same file (e.g. the 5A.2I POST
// handler that now shares app/api/data-hub/import-batches/route.ts with
// this file's own H.3 GET handler) even if the handler actually under
// test has been weakened or had its own gate removed entirely — that
// false-pass is exactly the gap this helper closes.
function extractHandlerBody(code: string, handlerName: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"): string {
  const marker = `export async function ${handlerName}(`;
  const start = code.indexOf(marker);
  if (start === -1) throw new Error(`No "${handlerName}" handler found in the given source.`);
  const nextExportStart = code.indexOf("\nexport ", start + 1);
  return nextExportStart === -1 ? code.slice(start) : code.slice(start, nextExportStart);
}

describe("H.3 route files exist at exactly the expected paths", () => {
  for (const relPath of ROUTE_FILES) {
    it(`${relPath} exists`, () => {
      expect(fs.existsSync(path.join(ROOT, relPath))).toBe(true);
    });
  }
});

describe("H.3 routes — no parser/storage/xlsx dependency, direct or transitive", () => {
  for (const relPath of ROUTE_FILES) {
    const stripped = stripComments(read(relPath));
    it(`${relPath} never imports xlsx directly or via workbookParser`, () => {
      expect(stripped).not.toMatch(/from\s+["']xlsx["']/);
      expect(stripped).not.toMatch(/workbookParser/);
      expect(stripped).not.toMatch(/\binspectWorkbook\b/);
      expect(stripped).not.toMatch(/\bdecodeWorksheet\(/);
    });
    it(`${relPath} never imports the storage layer (RawFileStore, compositionRoot, @vercel/blob)`, () => {
      expect(stripped).not.toMatch(/rawFileStore/i);
      expect(stripped).not.toMatch(/compositionRoot/);
      expect(stripped).not.toMatch(/@vercel\/blob/);
    });
    it(`${relPath} never imports inspectWorksheets/staleReclaim/legacy confirmImport`, () => {
      expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/inspectWorksheets["']/);
      expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/staleReclaim["']/);
      expect(stripped).not.toMatch(/confirmImport/);
      expect(stripped).not.toMatch(/services\/upload/);
    });
    it(`${relPath} never imports finalize, and never imports initiate unless it is the 5A.2I collection route (own POST handler, separately containment-tested by dataHubInitiateFinalizeRoutes.test.ts)`, () => {
      expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/finalize["']/);
      if (relPath === path.join("app", "api", "data-hub", "import-batches", "route.ts")) {
        expect(stripped).toMatch(/from\s+["'][^"']*importBatch\/initiate["']/);
      } else {
        expect(stripped).not.toMatch(/from\s+["'][^"']*importBatch\/initiate["']/);
      }
    });
    it(`${relPath} imports the H.2 read service and only that from the importBatch tree`, () => {
      expect(stripped).toMatch(/from\s+["']@\/lib\/data-hub\/importBatch\/read["']/);
    });
  }
});

// app/api/data-hub/import-batches/route.ts is deliberately excluded from
// the "no POST" assertion below — 5A.2I intentionally adds a POST
// (initiate) handler alongside this pre-existing H.3 GET handler in the
// SAME file. That handler's own write-shape/tenant/storage-authority
// containment is proven separately, exhaustively, by
// dataHubInitiateFinalizeRoutes.test.ts. Every other H.3 route file
// remains genuinely GET-only, unaffected by 5A.2I.
const COLLECTION_ROUTE = path.join("app", "api", "data-hub", "import-batches", "route.ts");

describe("H.3 routes — GET present; no PUT/PATCH/DELETE anywhere; no direct Prisma writes", () => {
  for (const relPath of ROUTE_FILES) {
    const stripped = stripComments(read(relPath));
    it(`${relPath} exports GET, and never PUT/PATCH/DELETE`, () => {
      expect(stripped).toMatch(/export\s+async\s+function\s+GET\s*\(/);
      expect(stripped).not.toMatch(/export\s+(async\s+)?function\s+PUT\s*\(/);
      expect(stripped).not.toMatch(/export\s+(async\s+)?function\s+PATCH\s*\(/);
      expect(stripped).not.toMatch(/export\s+(async\s+)?function\s+DELETE\s*\(/);
    });
    it(`${relPath} performs no direct writes — no create/update/delete/upsert/createMany Prisma calls in this file itself`, () => {
      expect(stripped).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/);
      expect(stripped).not.toMatch(/\$executeRaw/);
    });
  }

  it("only the collection route (import-batches/route.ts) exports POST among the four H.3 route files", () => {
    for (const relPath of ROUTE_FILES) {
      const stripped = stripComments(read(relPath));
      const hasPost = /export\s+async\s+function\s+POST\s*\(/.test(stripped);
      if (relPath === COLLECTION_ROUTE) {
        expect(hasPost).toBe(true);
      } else {
        expect(hasPost).toBe(false);
      }
    }
  });
});

describe("H.3 routes — authentication and trusted tenant context", () => {
  for (const relPath of ROUTE_FILES) {
    const code = read(relPath);
    it(`${relPath}'s GET handler requires requireRole("manager")`, () => {
      // Scoped to GET's own handler body specifically, not the whole
      // file: app/api/data-hub/import-batches/route.ts is shared with a
      // 5A.2I POST handler, which has its own, separately-verified
      // requireRole("manager") call (see
      // dataHubInitiateFinalizeRoutes.test.ts). A whole-file check here
      // would be satisfied by POST's own call even if GET's own gate
      // were weakened or removed — this per-handler scoping is what
      // actually proves the invariant for GET specifically. Checked
      // against comment-stripped code deliberately — a header comment
      // merely mentioning requireRole("manager") in prose must NOT be
      // sufficient to pass this check; only a real call inside GET's own
      // body counts.
      const getBody = stripComments(extractHandlerBody(code, "GET"));
      expect(getBody).toMatch(/requireRole\(\s*["']manager["']\s*\)/);
    });
    it(`${relPath} never reads organisationId/organisation_id from request input (searchParams, params, or headers)`, () => {
      // The only permitted source of tenant identity is
      // session.organisationId, obtained from requireRole's own return
      // value — never req.nextUrl.searchParams, never the dynamic route
      // `params`, never req.headers.
      expect(code).not.toMatch(/searchParams\.get\(\s*["']organi[sz]ation/i);
      expect(code).not.toMatch(/params\.organi[sz]ationId/i);
      expect(code).not.toMatch(/headers\.get\(\s*["']x-organi[sz]ation/i);
    });
    it(`${relPath}'s GET handler never parses a request body`, () => {
      // Scoped to the GET function body specifically, not the whole file:
      // app/api/data-hub/import-batches/route.ts is shared with a 5A.2I
      // POST handler (added on top of this pre-existing H.3 GET), which
      // legitimately parses a JSON request body for the initiate service's
      // own input fields — see dataHubInitiateFinalizeRoutes.test.ts for
      // that handler's own, separate containment. The GET handler itself,
      // in every route file including this shared one, must remain
      // entirely body-free.
      const getBody = extractHandlerBody(code, "GET");
      expect(getBody).not.toMatch(/req\.json\(\)/);
      expect(getBody).not.toMatch(/req\.body/);
    });
    it(`${relPath} never uses homeOrganisationId`, () => {
      expect(stripComments(code)).not.toMatch(/homeOrganisationId/);
    });
    it(`${relPath} passes session.organisationId into the H.2 service call`, () => {
      expect(stripComments(code)).toMatch(/organisationId:\s*session\.organisationId/);
    });
  }
});

describe("H.3 routes — deterministic error mapping, no leaked internals", () => {
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
    it(`${relPath} never returns a raw H.2 batch/worksheet object without going through the DTO field (batch:/worksheet:/worksheets:/batches:)`, () => {
      expect(stripComments(code)).toMatch(/NextResponse\.json\(\s*\{\s*(batch|batches|worksheet|worksheets)/);
    });
  }
});

describe("H.3 routes — cache policy", () => {
  for (const relPath of ROUTE_FILES) {
    const code = read(relPath);
    it(`${relPath} sets Cache-Control: private, no-store`, () => {
      expect(stripComments(code)).toMatch(/"Cache-Control":\s*"private,\s*no-store"/);
    });
  }
});

describe("H.3 collection route — cursor/limit boundary", () => {
  const code = read(path.join("app", "api", "data-hub", "import-batches", "route.ts"));

  it("rejects an oversized cursor before it reaches the H.2 service", () => {
    const stripped = stripComments(code);
    expect(stripped).toMatch(/MAX_CURSOR_LENGTH/);
    expect(stripped).toMatch(/cursorParam\.length\s*>\s*MAX_CURSOR_LENGTH/);
  });

  it("does not silently clamp an invalid limit — forwards to H.2's own validateLimit", () => {
    expect(code).not.toMatch(/Math\.min\(/);
    expect(code).not.toMatch(/Math\.max\(/);
  });

  it("uses URLSearchParams.get (first-occurrence-only) for cursor and limit, not getAll", () => {
    expect(code).not.toMatch(/getAll\(/);
  });
});
