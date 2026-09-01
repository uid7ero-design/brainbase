import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Deliberately no live `import ... from "@/lib/data-hub/importBatch/read"`
// here — matches the established convention for this dark module tree
// (inspectWorksheets.test.ts, dataHubImportBatchDarkness.test.ts): every
// property this file proves is proven via static source-text inspection
// only. Real runtime behavior (including that the four functions exist
// and are callable) is proven against a real Postgres instance by
// scripts/tests/worksheetReadService.integration.test.ts.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SERVICE_PATH = "lib/data-hub/importBatch/read.ts";

// ─── Static darkness / import-discipline containment ───────────────────

describe("read — static darkness/discipline containment", () => {
  const code = read(SERVICE_PATH);
  const stripped = stripComments(code);

  it("never imports xlsx directly or transitively via workbookParser", () => {
    expect(stripped).not.toMatch(/from\s+["']xlsx["']/);
    expect(stripped).not.toMatch(/require\(["']xlsx["']\)/);
    expect(stripped).not.toMatch(/workbookParser/);
    expect(stripped).not.toMatch(/\binspectWorkbook\b/);
    expect(stripped).not.toMatch(/\bdecodeWorksheet\(/);
  });

  it("never imports the storage layer (RawFileStore, compositionRoot, any storage/** module)", () => {
    expect(stripped).not.toMatch(/rawFileStore/i);
    expect(stripped).not.toMatch(/compositionRoot/);
    expect(stripped).not.toMatch(/from\s+["'][^"']*\/storage\//);
    expect(stripped).not.toMatch(/@vercel\/blob/);
  });

  it("never imports NextRequest/NextResponse or lib/org's session helpers", () => {
    expect(stripped).not.toMatch(/next\/server/);
    expect(stripped).not.toMatch(/requireSession|requireRole/);
    expect(stripped).not.toMatch(/from\s+["'].*lib\/org["']/);
  });

  it("never imports the legacy upload pipeline (services/upload.ts, app/api/upload/**, app/api/files/**)", () => {
    expect(stripped).not.toMatch(/services\/upload/);
    expect(stripped).not.toMatch(/api\/upload/);
    expect(stripped).not.toMatch(/api\/files/);
  });

  it("carries an AUTH BOUNDARY header comment", () => {
    expect(code).toMatch(/AUTH BOUNDARY/);
  });

  it("performs no writes — no create/update/delete/upsert/createMany Prisma calls", () => {
    expect(stripped).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/);
  });
});

describe("lib/data-hub/importBatch/ — no barrel/index.ts (re-confirmed here)", () => {
  it("contains no index.ts / index.tsx", () => {
    const dir = path.join(process.cwd(), "lib", "data-hub", "importBatch");
    const entries = fs.readdirSync(dir);
    expect(entries).not.toContain("index.ts");
    expect(entries).not.toContain("index.tsx");
  });
});

describe("read — repo-wide, no runtime caller exists yet", () => {
  const ROOT = process.cwd();
  function walk(dir: string, exts: string[]): string[] {
    const results: string[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return results;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...walk(full, exts));
      else if (exts.some((ext) => entry.name.endsWith(ext))) results.push(full);
    }
    return results;
  }
  it("no file under app/**, app/api/**, or components/** imports read.ts", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components"]) {
      const full = path.join(ROOT, dir);
      if (!fs.existsSync(full)) continue;
      const files = walk(full, [".ts", ".tsx"]);
      for (const file of files) {
        if (/from\s+["'][^"']*data-hub\/importBatch\/read["']/.test(read(path.relative(ROOT, file)))) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no server action, cron, or webhook file (heuristic: any file outside lib/data-hub/importBatch and its own tests) references any of the four exported read function names", () => {
    const offenders: string[] = [];
    const names = ["getImportBatch", "listImportBatches", "getWorksheet", "listWorksheetsForBatch"];
    for (const dir of ["app", "components", "scripts"]) {
      const full = path.join(ROOT, dir);
      if (!fs.existsSync(full)) continue;
      const files = walk(full, [".ts", ".tsx"]).filter((f) => !f.includes(`${path.sep}tests${path.sep}`));
      for (const file of files) {
        const relPath = path.relative(ROOT, file);
        const code = read(relPath);
        if (names.some((name) => code.includes(name)) && /from\s+["'][^"']*data-hub\/importBatch\/read["']/.test(code)) {
          offenders.push(relPath);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ─── Tenant + lineage predicate containment (source-text proof) ────────

describe("read — required tenant predicates (source-text containment)", () => {
  const code = read(SERVICE_PATH);

  it("getImportBatch's query includes id_organisation_id (compound tenant-scoped key)", () => {
    const start = code.indexOf("export async function getImportBatch");
    const end = code.indexOf("export async function listImportBatches");
    const body = code.slice(start, end);
    expect(body).toMatch(/id_organisation_id:\s*\{\s*id:\s*importBatchId,\s*organisation_id:\s*organisationId\s*\}/);
  });

  it("getWorksheet's single query includes id, organisation_id, AND lineage_kind together (not fetched by id alone)", () => {
    const start = code.indexOf("export async function getWorksheet");
    const end = code.indexOf("export async function listWorksheetsForBatch");
    const body = code.slice(start, end);
    const findFirstCallStart = body.indexOf("prisma.upload.findFirst({");
    const findFirstCallEnd = body.indexOf("});", findFirstCallStart);
    const whereClause = body.slice(findFirstCallStart, findFirstCallEnd);
    expect(whereClause).toMatch(/id:\s*worksheetId/);
    expect(whereClause).toMatch(/organisation_id:\s*organisationId/);
    expect(whereClause).toMatch(/lineage_kind:\s*["']DATA_HUB["']/);
  });

  it("listWorksheetsForBatch's Upload query includes import_batch_id, organisation_id, AND lineage_kind directly (not via nested relation filter)", () => {
    const start = code.indexOf("export async function listWorksheetsForBatch");
    const body = code.slice(start);
    const findManyCallStart = body.indexOf("prisma.upload.findMany({");
    const findManyCallEnd = body.indexOf("});", findManyCallStart);
    const whereClause = body.slice(findManyCallStart, findManyCallEnd);
    expect(whereClause).toMatch(/import_batch_id:\s*importBatchId/);
    expect(whereClause).toMatch(/organisation_id:\s*organisationId/);
    expect(whereClause).toMatch(/lineage_kind:\s*["']DATA_HUB["']/);
    expect(whereClause).not.toMatch(/import_batch:\s*\{/);
  });

  it("listImportBatches always restates organisation_id directly in its raw-SQL WHERE clause (never solely a nested relation filter)", () => {
    const start = code.indexOf("export async function listImportBatches");
    const end = code.indexOf("export async function getWorksheet");
    const body = code.slice(start, end);
    expect(body).toMatch(/WHERE organisation_id = \$\{organisationId\}/);
  });

  it("every worksheet-shaped query explicitly filters lineage_kind = 'DATA_HUB' (never inferred from import_batch_id alone)", () => {
    const matches = code.match(/lineage_kind:\s*["']DATA_HUB["']/g) ?? [];
    // getWorksheet's findFirst + listWorksheetsForBatch's findMany = 2 sites.
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("never introduces a distinguishable LINEAGE_MISMATCH outcome (outside its own explanatory comment)", () => {
    const stripped = stripComments(code);
    expect(stripped).not.toMatch(/LINEAGE_MISMATCH/);
  });

  it("never repurposes BATCH_NOT_READY for a read outcome (outside its own explanatory comment)", () => {
    const stripped = stripComments(code);
    expect(stripped).not.toMatch(/BATCH_NOT_READY/);
  });
});

describe("read — tombstone policy (source-text containment)", () => {
  const code = read(SERVICE_PATH);

  it("getImportBatch excludes tombstoned rows (deleted_at check)", () => {
    const start = code.indexOf("export async function getImportBatch");
    const end = code.indexOf("export async function listImportBatches");
    const body = code.slice(start, end);
    expect(body).toMatch(/deleted_at\s*!==\s*null/);
  });

  it("listImportBatches filters deleted_at IS NULL in its raw-SQL WHERE", () => {
    const start = code.indexOf("export async function listImportBatches");
    const end = code.indexOf("export async function getWorksheet");
    const body = code.slice(start, end);
    expect(body).toMatch(/AND deleted_at IS NULL/);
  });

  it("getWorksheet re-checks its parent batch's tombstone status via an explicit tenant-scoped ImportBatch lookup", () => {
    const start = code.indexOf("export async function getWorksheet");
    const end = code.indexOf("export async function listWorksheetsForBatch");
    const body = code.slice(start, end);
    expect(body).toMatch(/prisma\.importBatch\.findUnique/);
    expect(body).toMatch(/id_organisation_id/);
    expect(body).toMatch(/deleted_at\s*!==\s*null/);
  });

  it("listWorksheetsForBatch's parent-existence gate also excludes tombstoned batches", () => {
    const start = code.indexOf("export async function listWorksheetsForBatch");
    const body = code.slice(start);
    const gateEnd = body.indexOf("BATCH_NOT_FOUND");
    const gate = body.slice(0, gateEnd);
    expect(gate).toMatch(/deleted_at\s*!==\s*null/);
  });
});

describe("read — bounded pagination + deterministic ordering (source-text containment)", () => {
  const code = read(SERVICE_PATH);

  it("declares a default and max list limit", () => {
    expect(code).toMatch(/DEFAULT_LIST_LIMIT\s*=\s*50/);
    expect(code).toMatch(/MAX_LIST_LIMIT\s*=\s*200/);
  });

  it("listImportBatches fetches limit + 1 (raw-SQL LIMIT) to compute hasNextPage, never a COUNT(*)", () => {
    const start = code.indexOf("export async function listImportBatches");
    const end = code.indexOf("export async function getWorksheet");
    const body = code.slice(start, end);
    expect(body).toMatch(/LIMIT \$\{limit \+ 1\}/);
    expect(body).not.toMatch(/\.count\(/);
    expect(body).not.toMatch(/COUNT\(\*\)/i);
  });

  it("listImportBatches orders by the SAME millisecond-normalized expression its WHERE-clause cursor boundary uses, DESC, id DESC", () => {
    const start = code.indexOf("export async function listImportBatches");
    const end = code.indexOf("export async function getWorksheet");
    const body = code.slice(start, end);
    expect(body).toMatch(/ORDER BY date_trunc\('milliseconds', created_at\) DESC, id DESC/);
  });

  it("listWorksheetsForBatch orders strictly by worksheet_index asc and has no pagination parameters", () => {
    const start = code.indexOf("export async function listWorksheetsForBatch");
    const body = code.slice(start);
    expect(body).toMatch(/orderBy:\s*\{\s*worksheet_index:\s*["']asc["']\s*\}/);
  });

  it("ListWorksheetsForBatchTrustedContext has no cursor/limit fields", () => {
    const start = code.indexOf("export interface ListWorksheetsForBatchTrustedContext");
    const end = code.indexOf("}", start);
    const body = code.slice(start, end);
    expect(body).not.toMatch(/cursor/);
    expect(body).not.toMatch(/limit/);
  });
});

describe("read — cursor contract (source-text containment)", () => {
  const code = read(SERVICE_PATH);

  it("cursor encodes only createdAt and id — never organisation identity", () => {
    const start = code.indexOf("function encodeCursor");
    const end = code.indexOf("function decodeCursor");
    const body = code.slice(start, end);
    expect(body).toMatch(/createdAt/);
    expect(body).toMatch(/\bid\b/);
    expect(body).not.toMatch(/organisation/i);
  });

  it("decodeCursor validates structure and rejects malformed input by returning null (never throwing past the caller)", () => {
    const start = code.indexOf("function decodeCursor");
    const end = code.indexOf("function validateLimit");
    const body = code.slice(start, end);
    expect(body).toMatch(/try\s*\{/);
    expect(body).toMatch(/catch/);
    expect(body).toMatch(/return null/);
  });

  it("listImportBatches always reasserts organisation_id in the raw-SQL WHERE clause independent of any cursor value (organisation_id appears before the cursorFragment interpolation)", () => {
    const start = code.indexOf("export async function listImportBatches");
    const end = code.indexOf("export async function getWorksheet");
    const body = code.slice(start, end);
    const queryStart = body.indexOf("prisma.$queryRaw");
    const cursorFragmentSiteStart = body.indexOf("${cursorFragment}", queryStart);
    const beforeCursorFragment = body.slice(queryStart, cursorFragmentSiteStart);
    expect(beforeCursorFragment).toMatch(/WHERE organisation_id = \$\{organisationId\}/);
  });

  it("the cursorFragment's own comparison values are bound query parameters (createdAt/id), never string-interpolated into SQL text", () => {
    const start = code.indexOf("const cursorFragment");
    const end = code.indexOf("prisma.$queryRaw", start);
    const body = code.slice(start, end);
    expect(body).toMatch(/\$\{cursorTuple\.createdAt\}/);
    expect(body).toMatch(/\$\{cursorTuple\.id\}/);
  });
});

describe("read — listImportBatches raw-SQL safety (5A.2H.2 pagination-precision remediation)", () => {
  const code = read(SERVICE_PATH);
  const start = code.indexOf("export async function listImportBatches");
  const end = code.indexOf("export async function getWorksheet");
  const body = code.slice(start, end);

  it("never uses $queryRawUnsafe or any string-built SQL — only Prisma.sql tagged-template composition", () => {
    expect(body).not.toMatch(/\$queryRawUnsafe/);
    expect(body).not.toMatch(/\$executeRawUnsafe/);
    expect(body).toMatch(/prisma\.\$queryRaw<ImportBatchRow\[\]>\(Prisma\.sql`/);
  });

  it("uses Prisma.sql/Prisma.empty for the conditional cursor fragment, never manual string concatenation of SQL", () => {
    expect(body).toMatch(/Prisma\.sql`/);
    expect(body).toMatch(/Prisma\.empty/);
    expect(body).not.toMatch(/\+\s*["'`]\s*(WHERE|AND|SELECT)/i);
  });

  it("does not select any storage-internal or failure-metadata column in the summary list query", () => {
    const queryStart = body.indexOf("prisma.$queryRaw");
    const queryEnd = body.indexOf("`);", queryStart);
    const sqlText = body.slice(queryStart, queryEnd);
    expect(sqlText).not.toMatch(/storage_key|storage_provider|storage_etag|storage_deletion_status|storage_deleted_at/);
    expect(sqlText).not.toMatch(/last_failure_code|last_failure_message|last_failure_retryable|sha256|uploaded_by/);
  });

  it("selects an explicit, named column list — never SELECT *", () => {
    const queryStart = body.indexOf("prisma.$queryRaw");
    const queryEnd = body.indexOf("`);", queryStart);
    const sqlText = body.slice(queryStart, queryEnd);
    expect(sqlText).not.toMatch(/SELECT\s*\*/i);
    expect(sqlText).toMatch(/SELECT\s*\n\s*id,\s*\n\s*status,\s*\n\s*original_filename,\s*\n\s*content_type,\s*\n\s*size_bytes,/);
  });

  it("the millisecond-normalized expression appears in BOTH the SELECT/ORDER BY and the WHERE-clause cursor comparison — never mismatched precision on either side", () => {
    const strippedBody = stripComments(body);
    const occurrences = strippedBody.match(/date_trunc\('milliseconds', created_at\)/g) ?? [];
    // SELECT ... AS created_at (1) + ORDER BY (1) + cursorFragment's two
    // comparisons (2, only present when a cursor was supplied — but the
    // SOURCE TEXT always contains both regardless of runtime branch) = 4.
    expect(occurrences.length).toBe(4);
  });

  it("query results feed the existing explicit toSummaryDTO mapper — no raw row returned directly", () => {
    expect(body).toMatch(/page\.map\(toSummaryDTO\)/);
  });
});

// ─── DTO shape containment — forbidden fields must never appear ────────

describe("read — DTO shape containment (forbidden fields absent)", () => {
  const code = read(SERVICE_PATH);
  // Comments (this file's own header explicitly documents, BY NAME, every
  // field it excludes — see the module header comment) would otherwise
  // trip these checks against their own explanatory prose. Every check
  // below runs against comment-stripped code so it proves the EXECUTABLE
  // surface (selects/DTOs/types) never references these fields, matching
  // the established stripComments idiom used elsewhere in this suite for
  // exactly this self-referential-text problem.
  const stripped = stripComments(code);

  const forbidden = [
    "storage_key",
    "storage_provider",
    "storage_etag",
    "storage_deletion_status",
    "storage_deleted_at",
    "stored_path",
    "schema_type",
    "\\bmodule\\b",
    "row_count",
    "column_count",
    "columns_detected",
    "field_mappings",
    "validation_errors",
    "preview_rows",
    "\\bmetadata\\b",
    "original_name",
    "mimetype",
  ];

  it.each(forbidden)("never references forbidden persistence/legacy field: %s", (pattern) => {
    expect(stripped).not.toMatch(new RegExp(pattern));
  });

  it("never joins/selects User fields (name/email) through the uploaded_by/user relation", () => {
    expect(code).not.toMatch(/uploader:/);
    expect(code).not.toMatch(/user:\s*\{/);
    expect(code).not.toMatch(/\.name\b/);
    expect(code).not.toMatch(/\.email\b/);
  });

  it("DTOs are built via explicit field-by-field mapping functions, never a raw spread of a Prisma row", () => {
    expect(code).not.toMatch(/return\s*\{\s*\.\.\.(row|batch|worksheet)\s*,?\s*\}/);
    expect(code).not.toMatch(/return\s+row\b\s*;/);
    expect(code).not.toMatch(/return\s+batch\b\s*;/);
  });

  it("WorksheetSummaryDTO's own type declaration contains no forbidden legacy field names", () => {
    const start = code.indexOf("export interface WorksheetSummaryDTO");
    const end = code.indexOf("}", start);
    const body = code.slice(start, end);
    for (const field of ["storedPath", "schemaType", "rowCount", "columnCount", "mimetype", "originalName"]) {
      expect(body).not.toMatch(new RegExp(field));
    }
  });

  it("WORKSHEET_SELECT / WorksheetRow / toWorksheetDTO never reference Upload.size_bytes (a legacy/sentinel field for DATA_HUB rows — distinct from ImportBatch's own, legitimately-exposed size_bytes)", () => {
    for (const marker of ["const WORKSHEET_SELECT", "interface WorksheetRow", "function toWorksheetDTO"]) {
      const start = code.indexOf(marker);
      expect(start).toBeGreaterThan(-1);
      const end = code.indexOf("\n}", start) + 2;
      const body = code.slice(start, end);
      expect(body).not.toMatch(/size_bytes/);
    }
    const dtoStart = code.indexOf("export interface WorksheetSummaryDTO");
    const dtoEnd = code.indexOf("}", dtoStart);
    expect(code.slice(dtoStart, dtoEnd)).not.toMatch(/sizeBytes|size_bytes/);
  });

  it("ImportBatchDetailDTO's own type declaration contains no storage internals", () => {
    const start = code.indexOf("export interface ImportBatchDetailDTO");
    const end = code.indexOf("}", start);
    const body = code.slice(start, end);
    for (const field of ["storageKey", "storageProvider", "storageEtag", "storageDeletionStatus"]) {
      expect(body).not.toMatch(new RegExp(field));
    }
  });
});

// ─── Error taxonomy discipline ──────────────────────────────────────────

describe("read — fixed error taxonomy usage", () => {
  const code = read(SERVICE_PATH);

  it("every failure result is produced via the shared fail() helper backed by getMessageTemplate", () => {
    expect(code).toMatch(/getMessageTemplate/);
    expect(code).toMatch(/from\s+["']\.\/failureTaxonomy["']/);
  });

  it("never interpolates a raw caught error's message/stack into a returned message", () => {
    expect(code).not.toMatch(/err\.message/);
    expect(code).not.toMatch(/error\.message/);
    expect(code).not.toMatch(/\.stack\b/);
  });

  it("never contains a try/catch swallowing a real database error into a fabricated success", () => {
    expect(code).not.toMatch(/catch[\s\S]{0,80}ok:\s*true/);
  });
});

describe("read — exported function shapes (source-text containment)", () => {
  const code = read(SERVICE_PATH);

  it("exports exactly the four expected async read functions", () => {
    for (const name of ["getImportBatch", "listImportBatches", "getWorksheet", "listWorksheetsForBatch"]) {
      expect(code).toMatch(new RegExp(`export async function ${name}\\(`));
    }
  });
});
