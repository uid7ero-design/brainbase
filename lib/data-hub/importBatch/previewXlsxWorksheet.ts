import { createHash } from "node:crypto";
import { prisma } from "../../prisma";
import { classifyFormat } from "../fileSignatures";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import { PREVIEW_MAX_CELL_CHARS, PREVIEW_MAX_SAMPLE_COLUMNS, PREVIEW_MAX_SAMPLE_ROWS, boundColumns } from "../previewBounds";
import { buildImportBatchKey, RawFileStoreError } from "../storage/rawFileStore";
import { decodeWorksheet, WorkbookParserError } from "../workbookParser";
import { createImportBatchStorage } from "./compositionRoot";
import { getMessageTemplate, type FailureCode } from "./failureTaxonomy";

// Data Hub 6.2D2 — bounded, read-only XLSX worksheet content preview.
//
// Reached only via previewDataHubWorksheet.ts (the trusted dispatcher). This
// is a DISPLAY-ONLY service: it performs zero Prisma writes, no
// $transaction, and knows nothing about MappingVersion/SourceMapping or the
// Illegal Dumping mapper — the DTO carries generic content only, never
// required-header/mapping/domain-validity claims. XLSX confirmation and
// mapping selection remain server-blocked (confirmWorksheet.ts /
// selectWorksheetMapping.ts UNSUPPORTED_FORMAT gates are untouched).
//
// Every eligibility and lineage fact is re-read on EVERY call (no caching,
// no trust in the dispatcher's lookup), before any storage access:
//   1. tenant + DATA_HUB worksheet row (wrong tenant/legacy -> NOT_FOUND)
//   2. AWAITING_CONFIRMATION + visible + non-empty, persisted index present
//   3. parent batch READY, non-tombstoned, sha256 present
//   4. persisted content_type "xlsx" AND persisted original_filename
//      classifies as xlsx
// Then: server-derived storage key, bounded GET, SHA-256 verification, and
// decodeWorksheet with the PERSISTED worksheet_index only (the parser owns
// signature validation, the archive guard, and workload limits).
//
// TOCTOU / identity: the decoded worksheet's index, name, and visibility must
// match the persisted descriptor exactly. The bytes are already hash-pinned,
// so a disagreement means the persisted metadata no longer describes these
// bytes — fail closed with STORAGE_INTEGRITY_MISMATCH rather than display a
// worksheet other than the one the manager selected. There is never a
// worksheet-0 or name-based fallback.
//
// FORMULAS: SheetJS never evaluates formulas. sheet_to_json returns each
// cell's cached value (`v`); a formula cell with no cached value decodes as
// empty. Formula text itself is never returned. cellHTML is disabled in the
// parser, and every value is serialized as plain text.

export interface WorksheetContentPreviewDTO {
  worksheetId: string;
  worksheetName: string;
  worksheetIndex: number;
  rowCount: number;
  columnCount: number;
  headers: string[];
  sampleRows: string[][];
  sampleRowCount: number;
  truncated: boolean;
}

export type PreviewXlsxWorksheetFailureCode =
  | "WORKSHEET_NOT_FOUND"
  | "WORKSHEET_NOT_ELIGIBLE"
  | "BATCH_NOT_READY"
  | "UNSUPPORTED_FORMAT"
  | "STORAGE_NOT_FOUND"
  | "PROVIDER_FAILURE"
  | "STORAGE_INTEGRITY_MISMATCH"
  | "PARSER_REJECTED";

export type PreviewXlsxWorksheetResult =
  | { ok: true; preview: WorksheetContentPreviewDTO }
  | { ok: false; code: PreviewXlsxWorksheetFailureCode; message: string };

function fail(code: PreviewXlsxWorksheetFailureCode): PreviewXlsxWorksheetResult {
  return { ok: false, code, message: getMessageTemplate(code as FailureCode) };
}

function filenameClassifiesAsXlsx(filename: string): boolean {
  try {
    return classifyFormat({ filename }) === "xlsx";
  } catch {
    return false;
  }
}

function previewString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export async function previewXlsxWorksheet(context: {
  organisationId: string;
  worksheetId: string;
}): Promise<PreviewXlsxWorksheetResult> {
  const { organisationId, worksheetId } = context;
  const worksheet = await prisma.upload.findFirst({
    where: { id: worksheetId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
    select: {
      import_batch_id: true,
      worksheet_index: true,
      worksheet_name: true,
      worksheet_visibility: true,
      worksheet_is_empty: true,
      canonical_status: true,
    },
  });
  if (!worksheet || worksheet.import_batch_id === null) return fail("WORKSHEET_NOT_FOUND");
  if (worksheet.worksheet_index === null || worksheet.worksheet_name === null) return fail("WORKSHEET_NOT_ELIGIBLE");
  if (
    worksheet.canonical_status !== "AWAITING_CONFIRMATION" ||
    worksheet.worksheet_visibility !== "visible" ||
    worksheet.worksheet_is_empty !== false
  ) {
    return fail("WORKSHEET_NOT_ELIGIBLE");
  }

  const batch = await prisma.importBatch.findUnique({
    where: { id_organisation_id: { id: worksheet.import_batch_id, organisation_id: organisationId } },
    select: { status: true, deleted_at: true, sha256: true, content_type: true, original_filename: true },
  });
  if (!batch || batch.deleted_at !== null) return fail("WORKSHEET_NOT_FOUND");
  if (batch.status !== "READY") return fail("BATCH_NOT_READY");
  if (!batch.sha256) return fail("PROVIDER_FAILURE");
  if (batch.content_type !== "xlsx" || !filenameClassifiesAsXlsx(batch.original_filename)) return fail("UNSUPPORTED_FORMAT");

  const storage = createImportBatchStorage();
  let stored;
  try {
    stored = await storage.get(buildImportBatchKey(organisationId, worksheet.import_batch_id), {
      maxBytes: MAX_SOURCE_FILE_BYTES,
    });
  } catch (err) {
    if (err instanceof RawFileStoreError && err.code === "NOT_FOUND") return fail("STORAGE_NOT_FOUND");
    return fail("PROVIDER_FAILURE");
  }
  if (createHash("sha256").update(stored.body).digest("hex") !== batch.sha256) {
    return fail("STORAGE_INTEGRITY_MISMATCH");
  }

  let decoded;
  try {
    decoded = await decodeWorksheet(
      stored.body,
      { filename: batch.original_filename },
      { index: worksheet.worksheet_index }
    );
  } catch (err) {
    if (err instanceof WorkbookParserError) return fail("PARSER_REJECTED");
    throw err;
  }

  if (
    decoded.index !== worksheet.worksheet_index ||
    decoded.name !== worksheet.worksheet_name ||
    decoded.visibility !== "visible"
  ) {
    return fail("STORAGE_INTEGRITY_MISMATCH");
  }

  const displayedRows = decoded.rows.slice(0, PREVIEW_MAX_SAMPLE_ROWS).map((row) => row.map(previewString));
  const displayedCells = [decoded.headers, ...displayedRows].flatMap((row) => row.slice(0, PREVIEW_MAX_SAMPLE_COLUMNS));
  const sampleRows = displayedRows.map(boundColumns);
  const headers = boundColumns(decoded.headers);
  return {
    ok: true,
    preview: {
      worksheetId,
      worksheetName: worksheet.worksheet_name,
      worksheetIndex: worksheet.worksheet_index,
      rowCount: decoded.rowCount,
      columnCount: decoded.columnCount,
      headers,
      sampleRows,
      sampleRowCount: sampleRows.length,
      truncated:
        decoded.rowCount > sampleRows.length ||
        decoded.columnCount > PREVIEW_MAX_SAMPLE_COLUMNS ||
        displayedCells.some((cell) => cell.length > PREVIEW_MAX_CELL_CHARS),
    },
  };
}
