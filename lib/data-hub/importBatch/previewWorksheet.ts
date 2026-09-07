import { createHash } from "node:crypto";
import { prisma } from "../../prisma";
import { buildImportBatchKey, RawFileStoreError } from "../storage/rawFileStore";
import { createImportBatchStorage } from "./compositionRoot";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import { decodeCsvOnly, CsvOnlyDecodeError } from "../csvOnlyDecoder";
import { ILLEGAL_DUMPING_REQUIRED_HEADERS, IllegalDumpingMappingError, validateIllegalDumpingHeaders } from "./illegalDumpingMapper";
import { getMessageTemplate, type FailureCode } from "./failureTaxonomy";

// Data Hub 5A.3C.0 — dark^H^H live (route-wrapped) bounded, read-only CSV
// worksheet preview service. Design authority: the completed 5A.3C.0
// read-only discovery (see that phase's own report — sections D-M). This
// file implements exactly the architecture that discovery selected; it
// does not introduce any new design decision.
//
// AUTH BOUNDARY: identical discipline to every other importBatch service
// (initiate.ts/finalize.ts/inspectCsvWorksheet.ts/confirmWorksheet.ts/
// read.ts) — this function accepts an already-resolved trusted context
// (organisationId, worksheetId) as plain parameters. It never resolves its
// own auth/session. The route wrapping this service
// (app/api/data-hub/worksheets/[id]/preview/route.ts) enforces manager+
// role authorization via requireRole("manager") and derives organisationId
// exclusively from the resolved session, never from request input.
//
// TENANT-BEFORE-STORAGE (security-critical, discovery Section 13): the
// tenant+lineage-scoped worksheet lookup (Step 1), the eligibility check
// (Step 2), the tenant-scoped parent batch lookup (Step 3), and the format
// gate (Step 4) ALL happen before storage.get() is ever called (Step 5). A
// caller supplying another organisation's worksheet id can never cause
// this service to locate, HEAD, GET, decode, or hash that tenant's storage
// object — Steps 1-4 must all succeed, tenant-scoped, before Step 5 is
// ever reached.
//
// READ-ONLY: this function performs ZERO Prisma writes of any kind — no
// upload.update*, no importBatch.update*, no illegalDumping.createMany, no
// $transaction. It never confirms, imports, or mutates worksheet/batch
// status. It must NEVER import confirmWorksheet.ts or call
// confirmDataHubWorksheet.
//
// SCOPE: CSV-classified batches only, identical discipline to
// inspectCsvWorksheet.ts/confirmWorksheet.ts. This file MUST NOT import
// xlsx or workbookParser.ts, directly or transitively.
//
// BOUNDING (discovery Section H/I/M): decodeCsvOnly() already bounds the
// underlying parse work identically to inspect/confirm (MAX_SOURCE_FILE_BYTES
// at the storage layer, CSV_ONLY_LIMITS post-parse) — this service adds NO
// new parsing primitive and does not attempt to make the decode itself
// cheaper (discovery's own conclusion: a bounded preview built by slicing
// decodeCsvOnly's output costs the same CPU/memory as full inspect/confirm
// for the same file — a disclosed, accepted characteristic, not a defect).
// What IS new here are three RESPONSE-only bounds (PREVIEW_MAX_SAMPLE_ROWS/
// COLUMNS/CELL_CHARS below), which bound only the SERIALIZED payload size,
// never the shared decoder itself.

/** Response-only bounds — local to this file, not shared with any other
 * Data Hub decode path. No existing repo constant governs "how many rows
 * to show a human" (discovery Section M); these are new. */
const PREVIEW_MAX_SAMPLE_ROWS = 20;
const PREVIEW_MAX_SAMPLE_COLUMNS = 50;
const PREVIEW_MAX_CELL_CHARS = 200;

// CSV always yields exactly one worksheet, always index 0, always named
// "CSV" — matches inspectCsvWorksheet.ts's own CSV_WORKSHEET_INDEX/
// CSV_WORKSHEET_NAME constants exactly (duplicated rather than imported,
// consistent with this codebase's established convention of duplicating
// small format-structural literals across sibling CSV-only files rather
// than creating a shared import edge for a two-constant pair).
const CSV_WORKSHEET_INDEX = 0;
const CSV_WORKSHEET_NAME = "CSV";

export interface PreviewWorksheetTrustedContext {
  /** Trusted, already-authenticated caller context — never re-derived here. */
  organisationId: string;
  worksheetId: string;
}

export interface WorksheetPreviewDTO {
  worksheetId: string;
  worksheetName: string;
  worksheetIndex: number;
  rowCount: number;
  columnCount: number;
  headers: string[];
  sampleRows: string[][];
  sampleRowCount: number;
  truncated: boolean;
  requiredHeadersPresent: boolean;
  missingRequiredHeaders: string[];
}

export type PreviewWorksheetFailureCode =
  | "WORKSHEET_NOT_FOUND"
  | "WORKSHEET_NOT_ELIGIBLE"
  | "BATCH_NOT_READY"
  | "UNSUPPORTED_FORMAT"
  | "STORAGE_NOT_FOUND"
  | "PROVIDER_FAILURE"
  | "STORAGE_INTEGRITY_MISMATCH"
  | "PARSER_REJECTED";

export type PreviewWorksheetResult =
  | { ok: true; preview: WorksheetPreviewDTO }
  | { ok: false; code: PreviewWorksheetFailureCode; message: string };

function fail(code: PreviewWorksheetFailureCode): PreviewWorksheetResult {
  return { ok: false, code, message: getMessageTemplate(code as FailureCode) };
}

function truncateCell(cell: string): string {
  return cell.length > PREVIEW_MAX_CELL_CHARS ? `${cell.slice(0, PREVIEW_MAX_CELL_CHARS)}…(truncated)` : cell;
}

function boundColumns(row: string[]): string[] {
  return row.slice(0, PREVIEW_MAX_SAMPLE_COLUMNS).map(truncateCell);
}

/**
 * Produces a bounded, read-only, truthful content preview of a DATA_HUB
 * CSV worksheet: real server-derived headers, a bounded sample of actual
 * rows, and required-illegal-dumping-header presence — never the entire
 * file, never an unbounded sample, never any storage locator/token.
 *
 * Flow: tenant+lineage-scoped worksheet lookup -> eligibility check
 * (AWAITING_CONFIRMATION or IMPORTED only) -> tenant-scoped parent
 * ImportBatch lookup (READY, non-tombstoned, via the worksheet's own
 * persisted import_batch_id, never caller input) -> CSV-only format gate
 * -> bounded RawFileStore.get() -> mandatory SHA-256 re-verification
 * against the batch's own persisted sha256 (every call, never trusting a
 * prior inspect/preview's verification) -> xlsx-free CSV decode -> a
 * non-throwing required-header presence check -> response-only
 * row/column/cell bounding -> DTO. No database write of any kind.
 */
export async function previewWorksheet(context: PreviewWorksheetTrustedContext): Promise<PreviewWorksheetResult> {
  const { organisationId, worksheetId } = context;

  // ---- Step 1 — tenant + DATA_HUB lineage-scoped worksheet lookup. id,
  // organisation_id, and lineage_kind are ALL part of the SAME predicate —
  // never fetch-by-id-then-check. Nonexistent, wrong-tenant, and
  // LEGACY-lineage all collapse to the identical WORKSHEET_NOT_FOUND
  // outcome, reusing read.ts's/confirmWorksheet.ts's own established
  // code/semantics verbatim. NO storage access has happened yet. ----
  const worksheet = await prisma.upload.findFirst({
    where: { id: worksheetId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
    select: { id: true, import_batch_id: true, canonical_status: true },
  });
  if (!worksheet || worksheet.import_batch_id === null) {
    return fail("WORKSHEET_NOT_FOUND");
  }

  // ---- Step 2 — eligibility. Only AWAITING_CONFIRMATION (the core "review
  // before confirming" use case) and IMPORTED (historical review — mirrors
  // confirmDataHubWorksheet's own idempotent permissiveness for an
  // already-imported worksheet, never treated as an error there) are
  // previewable. INELIGIBLE/SKIPPED/any other value are rejected
  // identically via WORKSHEET_NOT_ELIGIBLE — deliberately not
  // distinguished further, mirroring WORKSHEET_NOT_FOUND's own
  // non-existence-leaking discipline. NO storage access has happened yet. ----
  if (worksheet.canonical_status !== "AWAITING_CONFIRMATION" && worksheet.canonical_status !== "IMPORTED") {
    return fail("WORKSHEET_NOT_ELIGIBLE");
  }

  // ---- Step 3 — parent ImportBatch lookup, via the worksheet's OWN
  // persisted import_batch_id (never caller input), tenant-scoped via the
  // compound id_organisation_id key. Must be READY and non-tombstoned —
  // mirrors confirmWorksheet.ts's own Step 3 exactly. NO storage access
  // has happened yet. ----
  const batch = await prisma.importBatch.findUnique({
    where: { id_organisation_id: { id: worksheet.import_batch_id, organisation_id: organisationId } },
    select: { status: true, content_type: true, sha256: true, deleted_at: true },
  });
  if (!batch || batch.deleted_at !== null) {
    return fail("WORKSHEET_NOT_FOUND");
  }
  if (batch.status !== "READY") {
    return fail("BATCH_NOT_READY");
  }
  if (!batch.sha256) {
    return fail("PROVIDER_FAILURE");
  }

  // ---- Step 4 — CSV-only format gate, using only trusted persisted
  // metadata, BEFORE any storage access. XLS/XLSX batches never reach
  // storage.get() from this service at all. ----
  if (batch.content_type !== "csv") {
    return fail("UNSUPPORTED_FORMAT");
  }

  // ---- Step 5 — bounded storage retrieval. ONLY reached after Steps 1-4
  // have all succeeded, tenant-scoped. Never a caller-provided path — the
  // storage key is derived exclusively from the trusted organisationId and
  // the worksheet's own persisted import_batch_id. ----
  const storage = createImportBatchStorage();
  const storageKey = buildImportBatchKey(organisationId, worksheet.import_batch_id);

  let getResult;
  try {
    getResult = await storage.get(storageKey, { maxBytes: MAX_SOURCE_FILE_BYTES });
  } catch (err) {
    if (err instanceof RawFileStoreError && err.code === "NOT_FOUND") {
      return fail("STORAGE_NOT_FOUND");
    }
    return fail("PROVIDER_FAILURE");
  }

  // ---- Step 6 — mandatory SHA-256 re-verification, unconditional, EVERY
  // invocation, against the batch's own persisted sha256 column only.
  // Never relies on a prior inspect/preview call's own verification — the
  // underlying Blob object could have been deleted/corrupted since. ----
  const computedSha256 = createHash("sha256").update(getResult.body).digest("hex");
  if (computedSha256 !== batch.sha256) {
    return fail("STORAGE_INTEGRITY_MISMATCH");
  }

  // ---- Step 7 — xlsx-free CSV decode. decodeCsvOnly also enforces
  // CSV_ONLY_LIMITS (row/column/cell caps), collapsing both malformed input
  // and oversized input to the single PARSER_REJECTED outcome — matching
  // inspectCsvWorksheet.ts's/confirmWorksheet.ts's own equivalent
  // handling. ----
  let headers: string[];
  let rows: string[][];
  try {
    const table = decodeCsvOnly(getResult.body);
    headers = table.headers;
    rows = table.rows;
  } catch (err) {
    if (err instanceof CsvOnlyDecodeError) {
      return fail("PARSER_REJECTED");
    }
    throw err;
  }

  // ---- Step 8 — required-header presence, non-throwing. Reuses
  // validateIllegalDumpingHeaders (the existing, pure, exported check)
  // verbatim as the single source of truth for "is this header set valid",
  // wrapped so its throw never escapes this service. missingRequiredHeaders
  // is derived independently from the same exported
  // ILLEGAL_DUMPING_REQUIRED_HEADERS constant, so it stays accurate even in
  // the duplicate-required-header case (where nothing is literally missing
  // — requiredHeadersPresent is false, but missingRequiredHeaders is
  // correctly empty, an honest distinct signal from "missing"). This is
  // the ONLY Illegal-Dumping-specific interpretation this service performs
  // — no per-row validation, no generic mapping/source-recognition
  // framework (discovery Section G/Y — deliberately deferred). ----
  const missingRequiredHeaders = ILLEGAL_DUMPING_REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  let requiredHeadersPresent = true;
  try {
    validateIllegalDumpingHeaders(headers);
  } catch (err) {
    if (err instanceof IllegalDumpingMappingError) {
      requiredHeadersPresent = false;
    } else {
      throw err;
    }
  }

  // ---- Step 9 — response-only bounding (discovery Section M). Never
  // mutates the shared decoder's own output in place; only the DTO fields
  // below are ever truncated/sliced. ----
  const rowCount = rows.length;
  const columnCount = Math.max(headers.length, ...rows.map((row) => row.length), 0);
  const sampleRows = rows.slice(0, PREVIEW_MAX_SAMPLE_ROWS).map(boundColumns);
  const sampleRowCount = sampleRows.length;
  const truncated = rowCount > sampleRowCount;
  const boundedHeaders = boundColumns(headers);

  return {
    ok: true,
    preview: {
      worksheetId,
      worksheetName: CSV_WORKSHEET_NAME,
      worksheetIndex: CSV_WORKSHEET_INDEX,
      rowCount,
      columnCount,
      headers: boundedHeaders,
      sampleRows,
      sampleRowCount,
      truncated,
      requiredHeadersPresent,
      missingRequiredHeaders,
    },
  };
}
