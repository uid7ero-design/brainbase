import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { buildImportBatchKey, RawFileStoreError } from "../storage/rawFileStore";
import { createImportBatchStorage } from "./compositionRoot";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import { decodeCsvOnly, CsvOnlyDecodeError } from "../csvOnlyDecoder";
import { getMessageTemplate, type FailureCode } from "./failureTaxonomy";

// Data Hub 5A.2K.2 — xlsx-free CSV-only worksheet inspection service (the
// first LIVE-exposed inspection path; wrapped by
// app/api/data-hub/import-batches/[id]/inspect/route.ts).
//
// WHY THIS IS A SEPARATE FILE FROM inspectWorksheets.ts (5A.2H.1), NOT A
// FORMAT-GATED WRAPPER AROUND IT: inspectWorksheets.ts imports
// inspectWorkbook from ../workbookParser.ts, which does
// `import * as XLSX from "xlsx"` unconditionally at module scope. Even
// though workbookParser.ts's own CSV branch (inspectCsvWorksheet,
// decodeCsvWorksheet) never calls into SheetJS at runtime, merely
// importing workbookParser.ts anywhere in a LIVE route's dependency graph
// still loads the xlsx package into the server process — a runtime
// content-type gate placed in FRONT of that import cannot undo the
// module-scope load. This is the exact same reasoning that motivated
// lib/data-hub/csvOnlyDecoder.ts (5A.2K.1) to be an independent sibling of
// workbookParser.ts's own CSV decode path rather than a thin wrapper
// around it — see that module's own header comment. This file extends the
// identical discipline to structural inspection: it MUST NOT import xlsx,
// workbookParser.ts, or inspectWorksheets.ts (which itself imports
// workbookParser.ts), directly or transitively.
// tests/containment/inspectCsvWorksheet.test.ts statically enforces this.
//
// AUTH BOUNDARY: identical discipline to every other importBatch service
// (initiate.ts/finalize.ts/inspectWorksheets.ts/confirmWorksheet.ts) —
// this function accepts an already-resolved trusted context
// (organisationId, importBatchId) as plain parameters. It never resolves
// its own auth/session. The route wrapping this service
// (app/api/data-hub/import-batches/[id]/inspect/route.ts) enforces
// manager+ role authorization via requireRole("manager") and derives
// organisationId exclusively from the resolved session, never from
// request input.
//
// SCOPE (5A.2K.2): CSV-classified batches only. XLS/XLSX are
// deterministically rejected (UNSUPPORTED_FORMAT), gated BEFORE any
// storage access, using only trusted persisted ImportBatch.content_type —
// never a caller-supplied format. This service therefore never attempts
// to inspect an XLS/XLSX batch even dark; inspectWorksheets.ts (still
// fully dark, zero runtime caller — see
// tests/containment/dataHubImportBatchDarkness.test.ts) remains the only
// path capable of that, and stays that way until a future, separate,
// explicitly-authorized phase addresses xlsx exposure.
//
// PERSISTENCE-SEMANTICS DUPLICATION (deliberate, not an oversight): the
// existing-set Case A-E idempotency/conflict policy below
// (classifyExistingSet/persistFirstTime/readExistingDataHubUploads) is a
// close structural mirror of inspectWorksheets.ts's own implementation of
// the identical algorithm. inspectWorksheets.ts's own persistence
// primitives are NOT imported here, and inspectWorksheets.ts is NOT
// modified to export them, because doing so would touch a currently
// dark, already-independently-reviewed file for a live-exposure phase
// that is explicitly scoped to add new files only (see this phase's own
// governing spec, Section 7: "Do NOT materially modify... inspectWorksheets.ts").
// The two implementations must be kept behaviourally equivalent by
// inspection/test, the same caveat csvOnlyDecoder.ts already carries for
// its own duplicated row/column/cell limit constants.
//
// DECODE-BEFORE-TRANSACTION: storage GET, SHA-256 re-verification, and
// CSV decode all happen before any database write. Persistence uses a
// single atomic createMany (Case A) or a plain read (Cases B-E) — never a
// write transaction wrapping storage/parse I/O.

export type CsvWorksheetCanonicalStatus = "AWAITING_CONFIRMATION" | "INELIGIBLE";

export interface InspectCsvWorksheetTrustedContext {
  /** Trusted, already-authenticated caller context — never re-derived here. */
  organisationId: string;
  importBatchId: string;
}

/** Structural worksheet metadata only — mirrors inspectWorksheets.ts's PersistedWorksheetDescriptor. */
export interface PersistedCsvWorksheetDescriptor {
  worksheetIndex: number;
  worksheetName: string;
  worksheetVisibility: "visible";
  worksheetIsEmpty: boolean;
  canonicalStatus: CsvWorksheetCanonicalStatus;
}

export type InspectCsvWorksheetFailureCode =
  | "BATCH_NOT_FOUND"
  | "BATCH_NOT_READY"
  | "UNSUPPORTED_FORMAT"
  | "STORAGE_NOT_FOUND"
  | "PROVIDER_FAILURE"
  | "STORAGE_INTEGRITY_MISMATCH"
  | "PARSER_REJECTED"
  | "PERSISTENCE_CONFLICT";

export type InspectCsvWorksheetResult =
  | { ok: true; worksheets: PersistedCsvWorksheetDescriptor[] }
  | { ok: false; code: InspectCsvWorksheetFailureCode; message: string };

function fail(code: InspectCsvWorksheetFailureCode): InspectCsvWorksheetResult {
  return { ok: false, code, message: getMessageTemplate(code as FailureCode) };
}

// CSV always yields exactly one worksheet, always visible (matches
// workbookParser.ts's own inspectCsvWorksheet hardcoded values — see that
// module's own CSV branch). Only emptiness varies.
const CSV_WORKSHEET_INDEX = 0;
const CSV_WORKSHEET_NAME = "CSV";

function deriveCanonicalStatus(isEmpty: boolean): CsvWorksheetCanonicalStatus {
  return isEmpty ? "INELIGIBLE" : "AWAITING_CONFIRMATION";
}

// Legacy NOT-NULL compatibility fields for the shared `uploads` table —
// duplicated verbatim from inspectWorksheets.ts's own values (Step 12 of
// that phase). worksheet_index remains the sole authoritative identity;
// none of these is ever used for lookup.
function resolveLegacyMimetype(): string {
  return "text/csv";
}

function buildLegacyOriginalName(originalFilename: string, descriptor: PersistedCsvWorksheetDescriptor): string {
  return `${originalFilename} :: worksheet[${descriptor.worksheetIndex}] "${descriptor.worksheetName}"`;
}

// Deliberately non-operable sentinel — identical construction to
// inspectWorksheets.ts's own buildStoredPathSentinel. Contains ':',
// rejected by RawFileStore's real validateStorageKey if ever mistakenly
// passed to buildImportBatchKey/head()/get()/delete(). Physical object
// ownership belongs exclusively to ImportBatch.
function buildStoredPathSentinel(importBatchId: string, worksheetIndex: number): string {
  return `datahub-worksheet:${importBatchId}:${worksheetIndex}`;
}

interface ExistingUploadRow {
  organisation_id: string;
  import_batch_id: string | null;
  worksheet_index: number | null;
  worksheet_name: string | null;
  worksheet_visibility: string | null;
  worksheet_is_empty: boolean | null;
  lineage_kind: string;
  canonical_status: string | null;
}

// Existing-set Case A-E policy — structural mirror of
// inspectWorksheets.ts's classifyExistingSet. See this file's own header
// comment for why this is duplicated rather than imported.
function classifyExistingSet(
  existing: ExistingUploadRow[],
  expected: PersistedCsvWorksheetDescriptor[],
  organisationId: string,
  importBatchId: string
): "MATCH" | "CONFLICT" {
  if (existing.length !== expected.length) return "CONFLICT";

  const expectedByIndex = new Map(expected.map((descriptor) => [descriptor.worksheetIndex, descriptor]));
  const seenIndices = new Set<number>();

  for (const row of existing) {
    if (
      row.organisation_id !== organisationId ||
      row.import_batch_id !== importBatchId ||
      row.lineage_kind !== "DATA_HUB" ||
      row.worksheet_index === null
    ) {
      return "CONFLICT";
    }
    if (seenIndices.has(row.worksheet_index)) return "CONFLICT";
    seenIndices.add(row.worksheet_index);

    const expectedDescriptor = expectedByIndex.get(row.worksheet_index);
    if (!expectedDescriptor) return "CONFLICT";

    if (
      row.worksheet_name !== expectedDescriptor.worksheetName ||
      row.worksheet_visibility !== expectedDescriptor.worksheetVisibility ||
      row.worksheet_is_empty !== expectedDescriptor.worksheetIsEmpty ||
      row.canonical_status !== expectedDescriptor.canonicalStatus
    ) {
      return "CONFLICT";
    }
  }

  return "MATCH";
}

async function readExistingDataHubUploads(organisationId: string, importBatchId: string): Promise<ExistingUploadRow[]> {
  return prisma.upload.findMany({
    where: { organisation_id: organisationId, import_batch_id: importBatchId, lineage_kind: "DATA_HUB" },
    orderBy: { worksheet_index: "asc" },
    select: {
      organisation_id: true,
      import_batch_id: true,
      worksheet_index: true,
      worksheet_name: true,
      worksheet_visibility: true,
      worksheet_is_empty: true,
      lineage_kind: true,
      canonical_status: true,
    },
  });
}

// First-time atomic persistence (Case A only) — structural mirror of
// inspectWorksheets.ts's persistFirstTime, including its P2002 recovery
// path (re-read + re-classify rather than assuming the racing writer's
// data matches).
async function persistFirstTime(
  organisationId: string,
  importBatchId: string,
  originalFilename: string,
  expected: PersistedCsvWorksheetDescriptor[]
): Promise<InspectCsvWorksheetResult> {
  const mimetype = resolveLegacyMimetype();

  const data: Prisma.UploadCreateManyInput[] = expected.map((descriptor) => ({
    organisation_id: organisationId,
    original_name: buildLegacyOriginalName(originalFilename, descriptor),
    stored_path: buildStoredPathSentinel(importBatchId, descriptor.worksheetIndex),
    mimetype,
    size_bytes: 0,
    import_batch_id: importBatchId,
    worksheet_index: descriptor.worksheetIndex,
    worksheet_name: descriptor.worksheetName,
    worksheet_visibility: descriptor.worksheetVisibility,
    worksheet_is_empty: descriptor.worksheetIsEmpty,
    lineage_kind: "DATA_HUB",
    canonical_status: descriptor.canonicalStatus,
  }));

  try {
    await prisma.upload.createMany({ data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await readExistingDataHubUploads(organisationId, importBatchId);
      const comparison = classifyExistingSet(existing, expected, organisationId, importBatchId);
      if (comparison === "MATCH") {
        return { ok: true, worksheets: expected };
      }
      return fail("PERSISTENCE_CONFLICT");
    }
    throw new Error("inspectCsvWorksheet: unexpected failure during first-time worksheet persistence.", { cause: err });
  }

  return { ok: true, worksheets: expected };
}

/**
 * Inspects a READY, CSV-classified ImportBatch's single worksheet and
 * persists structural-only worksheet lineage (one canonical Upload row,
 * lineage_kind = 'DATA_HUB', worksheet_index = 0). Idempotent: an
 * exact-match retry returns success without writing anything; any other
 * divergence from the freshly-derived expectation is a hard
 * PERSISTENCE_CONFLICT — never topped up, overwritten, or truncated.
 *
 * Flow: tenant-scoped ImportBatch lookup (requires status='READY') ->
 * CSV-only format gate (before any storage access) -> bounded
 * RawFileStore.get() -> mandatory SHA-256 re-verification against the
 * batch's own persisted sha256 -> xlsx-free CSV decode (structural only)
 * -> compare against any existing DATA_HUB Upload row for this batch ->
 * persist (Case A) or return success/PERSISTENCE_CONFLICT (Cases B-E).
 */
export async function inspectCsvWorksheet(context: InspectCsvWorksheetTrustedContext): Promise<InspectCsvWorksheetResult> {
  const { organisationId, importBatchId } = context;

  // Tenant-scoped batch lookup — id AND organisation_id in the SAME
  // predicate via ImportBatch's compound @@unique([id, organisation_id]).
  // A wrong-organisation batch and a genuinely nonexistent batch id
  // produce the identical BATCH_NOT_FOUND result.
  const batch = await prisma.importBatch.findUnique({
    where: { id_organisation_id: { id: importBatchId, organisation_id: organisationId } },
    select: { status: true, original_filename: true, content_type: true, sha256: true, deleted_at: true },
  });
  if (!batch || batch.deleted_at !== null) {
    return fail("BATCH_NOT_FOUND");
  }
  if (batch.status !== "READY") {
    return fail("BATCH_NOT_READY");
  }

  // CSV-only format gate, using only trusted persisted metadata, BEFORE
  // any storage access — mirrors confirmWorksheet.ts's own ordering
  // (Step 4 there). XLS/XLSX batches never reach storage.get() from this
  // service at all.
  if (batch.content_type !== "csv") {
    return fail("UNSUPPORTED_FORMAT");
  }

  if (!batch.sha256) {
    return fail("PROVIDER_FAILURE");
  }

  const storage = createImportBatchStorage();
  const storageKey = buildImportBatchKey(organisationId, importBatchId);

  let getResult;
  try {
    getResult = await storage.get(storageKey, { maxBytes: MAX_SOURCE_FILE_BYTES });
  } catch (err) {
    if (err instanceof RawFileStoreError && err.code === "NOT_FOUND") {
      return fail("STORAGE_NOT_FOUND");
    }
    return fail("PROVIDER_FAILURE");
  }

  const computedSha256 = createHash("sha256").update(getResult.body).digest("hex");
  if (computedSha256 !== batch.sha256) {
    return fail("STORAGE_INTEGRITY_MISMATCH");
  }

  // xlsx-free structural CSV inspection. decodeCsvOnly also enforces
  // CSV_ONLY_LIMITS (row/column/cell caps), collapsing both malformed
  // input and oversized input to the single PARSER_REJECTED outcome —
  // matching confirmWorksheet.ts's own equivalent handling.
  let headers: string[];
  let rowCount: number;
  try {
    const table = decodeCsvOnly(getResult.body);
    headers = table.headers;
    rowCount = table.rows.length;
  } catch (err) {
    if (err instanceof CsvOnlyDecodeError) {
      return fail("PARSER_REJECTED");
    }
    throw err;
  }

  // Matches workbookParser.ts's own inspectCsvWorksheet emptiness
  // semantic exactly: empty means the parsed table has no rows at all
  // (no header row either), not merely "no data rows". A header-only CSV
  // (headers present, zero data rows) is non-empty.
  const isEmpty = headers.length === 0 && rowCount === 0;

  const descriptor: PersistedCsvWorksheetDescriptor = {
    worksheetIndex: CSV_WORKSHEET_INDEX,
    worksheetName: CSV_WORKSHEET_NAME,
    worksheetVisibility: "visible",
    worksheetIsEmpty: isEmpty,
    canonicalStatus: deriveCanonicalStatus(isEmpty),
  };
  const expected = [descriptor];

  const existing = await readExistingDataHubUploads(organisationId, importBatchId);

  if (existing.length === 0) {
    // Case A.
    return persistFirstTime(organisationId, importBatchId, batch.original_filename, expected);
  }

  const comparison = classifyExistingSet(existing, expected, organisationId, importBatchId);
  if (comparison === "MATCH") {
    // Case B — idempotent success, nothing written.
    return { ok: true, worksheets: expected };
  }
  // Cases C, D, E — never topped up, truncated, or overwritten.
  return fail("PERSISTENCE_CONFLICT");
}
