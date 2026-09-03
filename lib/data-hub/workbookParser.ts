import { createHash } from "node:crypto";
import { parse as parseCsvSync } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { assertSafeXlsxArchive, ArchiveGuardError } from "./workbookArchiveGuard";
import { MAX_SOURCE_FILE_BYTES } from "./limits";
import {
  classifyFormat as classifyFormatFromFilename,
  validateSignature as validateSignatureBytes,
  FileSignatureError,
  type WorkbookFormat as SignatureWorkbookFormat,
} from "./fileSignatures";

// The sole seam between this module and SheetJS's XLSX.read. Every XLSX.read
// call in this file goes through xlsxAdapter.read rather than calling
// XLSX.read directly, so tests can instrument it (e.g. `vi.spyOn(xlsxAdapter,
// 'read')`) to prove that a rejected archive never reaches SheetJS at all —
// without redesigning this module for general dependency injection.
export const xlsxAdapter = {
  read: (bytes: Uint8Array, opts: XLSX.ParsingOptions): XLSX.WorkBook => XLSX.read(bytes, opts),
};

// Data Hub workbook parsing/identity foundation (Phase 5A.1).
//
// This module knows only raw workbook/file semantics: format classification,
// signature validation, content-addressable identity (SHA-256), worksheet
// inventory, and bounded/selected worksheet decoding. It deliberately does
// NOT know about BrainBase schema detection, column mapping, canonical
// import semantics, persistence, or storage — see lib/schema-detector.ts and
// lib/column-mapper.ts for that layer, which consumes the plain rows this
// module returns.
//
// Every value returned by this module's public functions is a
// serialization-safe plain value (string, number, boolean, null, or a plain
// array/object of those) — never a Date instance and never a mutable SheetJS
// WorkBook/WorkSheet object. See normalizeCellValue.

// Re-exported from fileSignatures.ts (5A.2G.1 extraction) rather than
// declared here a second time — see that module's header comment for why
// this type now lives in the xlsx-free module.
export type WorkbookFormat = SignatureWorkbookFormat;

export type WorksheetVisibility = "visible" | "hidden" | "veryHidden";

export interface WorkbookInput {
  /** Original filename, used to classify format. Required — see classifyFormat. */
  filename: string;
  /** Browser/client-supplied MIME type. Advisory only, never trusted for classification. */
  mimeType?: string;
}

export type WorkbookParserErrorCode =
  | "UNSUPPORTED_FILE_TYPE"
  | "INVALID_FILE_SIGNATURE"
  | "MALFORMED_WORKBOOK"
  | "WORKBOOK_LIMIT_EXCEEDED"
  | "WORKSHEET_LIMIT_EXCEEDED"
  | "WORKSHEET_NOT_FOUND"
  // 5A.2D — the XLSX archive/decompression boundary (workbookArchiveGuard.ts).
  // ARCHIVE_LIMIT_EXCEEDED: a resource-budget cap was exceeded (entry
  // count, compressed/uncompressed bytes, filename/extra-field length).
  // UNSAFE_ARCHIVE: the archive's structure itself is unsafe/ambiguous
  // (encryption, unsupported compression, ZIP64, data descriptors, unsafe
  // or colliding names, central/local disagreement, CRC mismatch,
  // overlapping/duplicate ranges, disallowed comments, multi-disk) even
  // though it may be well *within* every resource budget.
  | "ARCHIVE_LIMIT_EXCEEDED"
  | "UNSAFE_ARCHIVE";

export interface WorkbookParserErrorDetails {
  limit?: string;
  maximum?: number;
  actual?: number;
  worksheetIndex?: number;
  [key: string]: unknown;
}

export class WorkbookParserError extends Error {
  readonly code: WorkbookParserErrorCode;
  readonly details?: WorkbookParserErrorDetails;
  readonly cause?: unknown;

  constructor(
    code: WorkbookParserErrorCode,
    message: string,
    details?: WorkbookParserErrorDetails,
    cause?: unknown
  ) {
    super(message);
    this.name = "WorkbookParserError";
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
}

export interface WorkbookLimits {
  /** Original (compressed, on-disk) byte size of the uploaded file. */
  maxOriginalBytes: number;
  /** Number of worksheets a workbook may declare. */
  maxWorksheetCount: number;
  /** Data rows (excluding header) a single *selected* worksheet may materialize. */
  maxSelectedWorksheetRows: number;
  /** Columns a single *selected* worksheet may materialize. */
  maxSelectedWorksheetColumns: number;
  /** Total cells a single *selected* worksheet may materialize — see computeMaterializedCellCount for the exact definition. */
  maxSelectedWorksheetCells: number;
}

// Approved 5A.1 defaults. These bound a single application's ingestion
// workload — they are not a claim about safe enterprise-scale limits, and
// (per the accompanying ADR) they do not defend against malicious archive
// decompression: SheetJS remains a fully in-memory parser regardless of
// these values.
export const DEFAULT_WORKBOOK_LIMITS: WorkbookLimits = {
  // Sourced from lib/data-hub/limits.ts's single canonical
  // MAX_SOURCE_FILE_BYTES (5A.2G.1) rather than a second, independently
  // maintained 20 MiB literal — see that module's header comment.
  maxOriginalBytes: MAX_SOURCE_FILE_BYTES,
  maxWorksheetCount: 50,
  maxSelectedWorksheetRows: 100_000,
  maxSelectedWorksheetColumns: 1_000,
  maxSelectedWorksheetCells: 2_000_000,
};

// previewRowCount = 0 is a deliberately supported contract (headers/identity
// only, no data preview) — see assertNonNegativeSafeInteger below. It is
// NOT the same as an unvalidated negative value, which historically reached
// SheetJS's sheetRows option as 0 and was misinterpreted as "unlimited".
export const DEFAULT_PREVIEW_ROW_COUNT = 10;

export interface WorksheetInspection {
  /** Zero-based, authoritative for later selection via decodeWorksheet. */
  index: number;
  /** Descriptive only — never used to select a worksheet. */
  name: string;
  visibility: WorksheetVisibility;
  isEmpty: boolean;
  /**
   * The workbook's *declared* rectangular dimension for this sheet (from the
   * sheet's dimension metadata) — a preflight/early-rejection signal, NOT a
   * measurement of actually-populated rows/columns. A sparse worksheet can
   * declare a large range with few real values. Undefined for CSV, which has
   * no equivalent declaration.
   */
  declaredRangeRows?: number;
  declaredRangeColumns?: number;
  headers: string[];
  /** Bounded to at most the configured preview row count. */
  previewRows: unknown[][];
  /**
   * For CSV: exact — true only when parsing found at least one more row
   * beyond the preview window.
   * For XLS/XLSX: a conservative, bounded-inspection signal — true when the
   * worksheet's declared range extends beyond the preview parse window. It
   * does NOT by itself prove another populated data row exists; sparse or
   * distant declared cells can trip this without additional real content.
   */
  previewTruncated: boolean;
}

export interface WorkbookInspection {
  format: WorkbookFormat;
  /** SHA-256 (hex) over the exact original bytes. Not persisted by this module. */
  sha256: string;
  worksheets: WorksheetInspection[];
}

export interface InspectWorkbookOptions {
  previewRowCount?: number;
  limits?: Partial<Pick<WorkbookLimits, "maxOriginalBytes" | "maxWorksheetCount">>;
}

export interface WorksheetSelection {
  /** Zero-based, authoritative. Worksheet name is never used for selection. */
  index: number;
}

export interface DecodeWorksheetOptions {
  limits?: Partial<
    Pick<
      WorkbookLimits,
      "maxOriginalBytes" | "maxWorksheetCount" | "maxSelectedWorksheetRows" | "maxSelectedWorksheetColumns" | "maxSelectedWorksheetCells"
    >
  >;
}

export interface DecodedWorksheet {
  index: number;
  name: string;
  visibility: WorksheetVisibility;
  headers: string[];
  rows: unknown[][];
  rowCount: number;
  /** The widest row actually returned (max of headers.length and every data row's length) — not merely headers.length, so a ragged/wider row cannot bypass column enforcement. */
  columnCount: number;
}

// ---------------------------------------------------------------------------
// Numeric option validation. Invalid parser configuration (NaN, Infinity,
// negative, fractional, or unsafe-integer limits/previewRowCount) is a
// programmer error, not a data problem — it throws RangeError directly and
// is never caught and reinterpreted as MALFORMED_WORKBOOK by any try/catch
// in this module (validation always runs outside those blocks).
// ---------------------------------------------------------------------------

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer; received ${String(value)}.`);
  }
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer; received ${String(value)}.`);
  }
}

function validateLimits(limits: WorkbookLimits): void {
  assertPositiveSafeInteger(limits.maxOriginalBytes, "maxOriginalBytes");
  assertPositiveSafeInteger(limits.maxWorksheetCount, "maxWorksheetCount");
  assertPositiveSafeInteger(limits.maxSelectedWorksheetRows, "maxSelectedWorksheetRows");
  assertPositiveSafeInteger(limits.maxSelectedWorksheetColumns, "maxSelectedWorksheetColumns");
  assertPositiveSafeInteger(limits.maxSelectedWorksheetCells, "maxSelectedWorksheetCells");
}

function validatePreviewRowCount(previewRowCount: number): void {
  assertNonNegativeSafeInteger(previewRowCount, "previewRowCount");
}

// The real classification/signature logic now lives in fileSignatures.ts
// (5A.2G.1 extraction, xlsx-free) so finalize.ts can reuse it without
// pulling xlsx into its import graph — see that module's header comment.
// These two thin wrappers exist only to translate FileSignatureError into
// this module's own public WorkbookParserError contract (exact same codes,
// messages, and details every existing caller/test already depends on) —
// no format/signature logic is duplicated here.

// Format is classified from filename/extension only. MIME is intentionally
// never consulted here — a browser-supplied MIME type is untrusted advisory
// metadata, not a basis for deciding how to parse the bytes.
function classifyFormat(input: WorkbookInput): WorkbookFormat {
  try {
    return classifyFormatFromFilename(input);
  } catch (err) {
    if (err instanceof FileSignatureError) {
      throw new WorkbookParserError(err.code, err.message, err.details);
    }
    throw err;
  }
}

// Signature validation rejects an obviously wrong file cheaply, before any
// parsing is attempted. It is necessary but NOT sufficient on its own for
// xlsx: every ZIP file shares the same local-file-header signature — a
// genuinely valid ZIP that is not an OOXML workbook still passes this check
// and is only rejected once structural workbook recognition fails (see
// readSheetNamesOnly; proven with a real, independently-verified ZIP fixture
// in the test suite, not just malformed bytes).
function validateSignature(format: WorkbookFormat, bytes: Uint8Array): void {
  try {
    validateSignatureBytes(format, bytes);
  } catch (err) {
    if (err instanceof FileSignatureError) {
      throw new WorkbookParserError(err.code, err.message, err.details);
    }
    throw err;
  }
}

// 5A.2D mandatory call order: this must run — and its returned promise must
// resolve successfully — before xlsxAdapter.read is ever called for an
// "xlsx"-classified input. It never runs for "xls" (BIFF8 is a single
// sequential stream, not a ZIP archive with independently-decompressible
// entries — no ZIP-bomb vector exists there) or "csv" (no archive at all).
// Any ArchiveGuardError is translated into the public WorkbookParserError
// contract; any other error propagates as-is (there should be none —
// assertSafeXlsxArchive's own contract is to only ever throw
// ArchiveGuardError or a RangeError from its own limit validation).
async function assertGuardedXlsxArchive(bytes: Uint8Array): Promise<void> {
  try {
    await assertSafeXlsxArchive(bytes);
  } catch (err) {
    if (err instanceof ArchiveGuardError) {
      throw new WorkbookParserError(err.code, err.message, err.details, err.cause);
    }
    throw err;
  }
}

function computeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function mapVisibility(hidden: 0 | 1 | 2 | undefined): WorksheetVisibility {
  if (hidden === 1) return "hidden";
  if (hidden === 2) return "veryHidden";
  return "visible";
}

// ---------------------------------------------------------------------------
// Plain-data normalization. cellDates:true can hand back JavaScript Date
// instances from SheetJS; this module's public contract is serialization-
// safe plain values only, so every Date is converted to an ISO-8601 UTC
// string before it can leave the parser. An invalid Date (NaN time — SheetJS
// can produce one from a malformed date serial) normalizes to null rather
// than letting toISOString() throw. Ordinary strings/numbers/booleans/null
// pass through untouched.
// ---------------------------------------------------------------------------

function normalizeCellValue(value: unknown): unknown {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return value;
}

function normalizeRow(row: unknown[]): unknown[] {
  return row.map(normalizeCellValue);
}

function normalizeRows(rows: unknown[][]): unknown[][] {
  return rows.map(normalizeRow);
}

function toHeaderStrings(row: unknown[] | undefined): string[] {
  if (!row) return [];
  return row.map((value) => {
    const normalized = normalizeCellValue(value);
    return normalized === null || normalized === undefined ? "" : String(normalized);
  });
}

// The widest row actually returned — headers plus every decoded data row —
// not merely headers.length. CSV allows ragged rows, and a later row can
// legitimately contain more fields than the header; using headers.length
// alone would let such a row bypass maxSelectedWorksheetColumns entirely.
function computeColumnExtent(headers: string[], rows: unknown[][]): number {
  let max = headers.length;
  for (const row of rows) {
    if (row.length > max) max = row.length;
  }
  return max;
}

// Materialized cell count = the actual number of value slots retained in the
// returned DecodedWorksheet: headers.length plus the length of every decoded
// data row, summed. This deliberately does NOT invent values for absent
// rectangular positions in a ragged/sparse table (it is not rowCount x
// columnCount) — it counts only what was actually returned.
function computeMaterializedCellCount(headers: string[], rows: unknown[][]): number {
  let total = headers.length;
  for (const row of rows) total += row.length;
  return total;
}

// Cheap, decode-free pass: sheet names and count only. Used to reject an
// excessive worksheet count before any cell data is materialized.
function readSheetNamesOnly(bytes: Uint8Array): string[] {
  let wb: XLSX.WorkBook;
  try {
    wb = xlsxAdapter.read(bytes, { type: "buffer", bookSheets: true });
  } catch (err) {
    throw new WorkbookParserError(
      "MALFORMED_WORKBOOK",
      "The file could not be recognized as a valid workbook.",
      undefined,
      err
    );
  }
  const sheetNames = wb.SheetNames ?? [];
  if (sheetNames.length === 0) {
    throw new WorkbookParserError("MALFORMED_WORKBOOK", "The workbook contains no worksheets.");
  }
  return sheetNames;
}

function assertWorksheetCount(sheetNames: string[], limits: WorkbookLimits): void {
  if (sheetNames.length > limits.maxWorksheetCount) {
    throw new WorkbookParserError("WORKBOOK_LIMIT_EXCEEDED", "The workbook has too many worksheets.", {
      limit: "maxWorksheetCount",
      maximum: limits.maxWorksheetCount,
      actual: sheetNames.length,
    });
  }
}

function readDeclaredRange(ws: XLSX.WorkSheet): { rows: number; columns: number } | undefined {
  // !fullref carries the true declared dimension when sheetRows truncated
  // the read; !ref alone is the declared dimension otherwise (or the
  // truncated one, when there is no !fullref because no truncation occurred).
  const ref = ws["!fullref"] ?? ws["!ref"];
  if (!ref) return undefined;
  const range = XLSX.utils.decode_range(ref);
  return {
    rows: range.e.r - range.s.r + 1,
    columns: range.e.c - range.s.c + 1,
  };
}

// A sheet is empty only by its declared structure, independent of any
// preview window: no declared range at all, or a degenerate single-cell
// range with no actual value in that cell.
function isWorksheetEmpty(ws: XLSX.WorkSheet): boolean {
  const ref = ws["!fullref"] ?? ws["!ref"];
  if (!ref) return true;
  const range = XLSX.utils.decode_range(ref);
  const isSingleCell = range.s.r === range.e.r && range.s.c === range.e.c;
  if (!isSingleCell) return false;
  const address = XLSX.utils.encode_cell(range.s);
  const cell = ws[address] as XLSX.CellObject | undefined;
  return cell === undefined || cell.v === undefined || cell.v === null || cell.v === "";
}

function inspectCsvWorksheet(bytes: Uint8Array, previewRowCount: number): WorksheetInspection {
  const text = Buffer.from(bytes).toString("utf8");
  // Ask for one row beyond the preview window so truncation can be detected
  // cheaply, without parsing the entire (already size-capped) file.
  let sample: unknown[][];
  try {
    sample = parseCsvSync(text, { bom: true, to: previewRowCount + 2, relax_column_count: true }) as unknown[][];
  } catch (err) {
    throw new WorkbookParserError("MALFORMED_WORKBOOK", "The file could not be parsed as CSV.", undefined, err);
  }
  const headers = toHeaderStrings(sample[0]);
  const dataRows = sample.slice(1);
  const previewTruncated = dataRows.length > previewRowCount;
  const previewRows = normalizeRows(dataRows.slice(0, previewRowCount));
  return {
    index: 0,
    name: "CSV",
    visibility: "visible",
    isEmpty: sample.length === 0,
    declaredRangeRows: undefined,
    declaredRangeColumns: undefined,
    headers,
    previewRows,
    previewTruncated,
  };
}

// RESOLVED (5A.2J.0 — was a KNOWN LIMITATION documented but not fixed at
// 5A.2H.1; see docs/architecture/decisions/0001-data-hub-ingestion-
// foundation.md's 5A.2H.1 section for the original write-up, and its
// 5A.2J.0 addendum for this fix): the `wb.Sheets` object SheetJS hands
// back from a whole-workbook read is keyed by SHEET NAME, not position.
// Empirically verified (5A.2J.0 discovery/implementation): when two or
// more worksheets share an identical name, SheetJS's own whole-book parse
// itself — not merely a subsequent lookup — retains only the LAST-PARSED
// colliding sheet's cell data under that shared key; the earlier
// colliding sheet(s)' content is not recoverable from that same parsed
// `WorkBook` object at all, under any property. A plain `wb.Sheets[name]`
// lookup (the previous implementation) therefore returned the wrong
// physical sheet's content — including a wrong `isEmpty` — for every
// colliding index except the last.
//
// FIX: detect which names collide (via a frequency count over
// `sheetNames`) and, for those indices ONLY, re-read the workbook with an
// explicit `sheets: [index]` filter — mirroring decodeWorksheet's own
// already-safe pattern below exactly, which materializes exactly one
// worksheet per call and therefore cannot collide with any other index
// regardless of shared names. A workbook with no duplicate names pays
// zero extra cost — every index still resolves via the single whole-book
// read's `wb.Sheets[name]`, byte-for-byte the prior behavior. A workbook
// WITH duplicate names pays one additional targeted read per colliding
// index (never per total sheet count), bounded by maxWorksheetCount (50)
// in the pathological all-same-name case — the same per-call resource
// envelope decodeWorksheet already uses and this codebase already accepts
// for worksheet-by-worksheet confirmation. Each targeted read still
// respects the same `sheetRows` preview bound as the original read, so no
// call here materializes more data than a single already-bounded read
// would. Per the existing CORRECTION comment on decodeSpreadsheetWorksheet
// below, the `sheets` option does not reduce ZIP-decompression cost itself
// (cfb decompresses every archive entry unconditionally) — so each extra
// targeted read here does re-pay full-archive decompression, not just
// cell materialization; this is a real, bounded (by the 50-worksheet cap)
// per-collision cost, not an unbounded one, and applies only to workbooks
// that actually contain duplicate-named sheets.
//
// `index`, `name`, and `visibility` were always positionally correct
// (`sheetNames` and the `!Workbook.Sheets` visibility array are both
// consumed positionally, never through the name-keyed dictionary) and
// remain so — this fix touches only the per-index worksheet CONTENT
// lookup. decodeWorksheet (below) was independently verified, both by
// the 5A.2J.0 discovery pass and by this implementation's own
// cross-check, to already be safe against this exact collision — it is
// unchanged by this fix.
function inspectSpreadsheetWorksheets(
  bytes: Uint8Array,
  sheetNames: string[],
  previewRowCount: number
): WorksheetInspection[] {
  let wb: XLSX.WorkBook;
  try {
    wb = xlsxAdapter.read(bytes, {
      type: "buffer",
      sheetRows: previewRowCount + 1, // + header row
      cellDates: true,
      cellHTML: false,
    });
  } catch (err) {
    throw new WorkbookParserError(
      "MALFORMED_WORKBOOK",
      "The file could not be recognized as a valid workbook.",
      undefined,
      err
    );
  }
  const visibilities = readVisibilities(wb, sheetNames.length);

  // Names appearing more than once in this workbook cannot be safely
  // resolved via `wb.Sheets[name]` on the whole-book read above — see the
  // header comment on this function.
  const nameOccurrences = new Map<string, number>();
  for (const name of sheetNames) {
    nameOccurrences.set(name, (nameOccurrences.get(name) ?? 0) + 1);
  }

  function resolveWorksheet(name: string, index: number): XLSX.WorkSheet | undefined {
    if ((nameOccurrences.get(name) ?? 0) <= 1) {
      return wb.Sheets[name];
    }
    let wbForIndex: XLSX.WorkBook;
    try {
      wbForIndex = xlsxAdapter.read(bytes, {
        type: "buffer",
        sheets: [index],
        sheetRows: previewRowCount + 1,
        cellDates: true,
        cellHTML: false,
      });
    } catch (err) {
      throw new WorkbookParserError(
        "MALFORMED_WORKBOOK",
        "The file could not be recognized as a valid workbook.",
        undefined,
        err
      );
    }
    return wbForIndex.Sheets[name];
  }

  return sheetNames.map((name, index) => {
    const ws = resolveWorksheet(name, index);
    if (!ws) {
      return {
        index,
        name,
        visibility: visibilities[index],
        isEmpty: true,
        headers: [],
        previewRows: [],
        previewTruncated: false,
      };
    }
    const declaredRange = readDeclaredRange(ws);
    const rowsAoA = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: null });
    return {
      index,
      name,
      visibility: visibilities[index],
      isEmpty: isWorksheetEmpty(ws),
      declaredRangeRows: declaredRange?.rows,
      declaredRangeColumns: declaredRange?.columns,
      headers: toHeaderStrings(rowsAoA[0] as unknown[] | undefined),
      previewRows: normalizeRows(rowsAoA.slice(1, previewRowCount + 1)),
      previewTruncated: Boolean(ws["!fullref"]),
    };
  });
}

function readVisibilities(wb: XLSX.WorkBook, count: number): WorksheetVisibility[] {
  const sheetProps = wb.Workbook?.Sheets ?? [];
  const result: WorksheetVisibility[] = [];
  for (let i = 0; i < count; i++) {
    result.push(mapVisibility(sheetProps[i]?.Hidden));
  }
  return result;
}

/**
 * Inspects a workbook's structure: format, content identity (SHA-256), and
 * an ordered, bounded-preview inventory of every worksheet. Does not return
 * full row sets, and does not perform BrainBase schema detection.
 *
 * Async (5A.2D): for "xlsx" input, the archive/decompression boundary
 * (assertGuardedXlsxArchive) must resolve successfully before any SheetJS
 * call — see the mandatory call order documented on that function. There
 * were zero production callers of this function at the time of that change
 * (verified during 5A.2D discovery), making this the correct time to make
 * the public contract consistently Promise-based rather than adding a
 * separate sync/async pair of entry points.
 */
export async function inspectWorkbook(
  bytes: Uint8Array,
  input: WorkbookInput,
  options: InspectWorkbookOptions = {}
): Promise<WorkbookInspection> {
  const limits: WorkbookLimits = { ...DEFAULT_WORKBOOK_LIMITS, ...options.limits };
  const previewRowCount = options.previewRowCount ?? DEFAULT_PREVIEW_ROW_COUNT;
  validateLimits(limits);
  validatePreviewRowCount(previewRowCount);

  if (bytes.byteLength > limits.maxOriginalBytes) {
    throw new WorkbookParserError("WORKBOOK_LIMIT_EXCEEDED", "The file exceeds the maximum allowed size.", {
      limit: "maxOriginalBytes",
      maximum: limits.maxOriginalBytes,
      actual: bytes.byteLength,
    });
  }

  const format = classifyFormat(input);
  validateSignature(format, bytes);
  const sha256 = computeSha256(bytes);

  if (format === "csv") {
    return { format, sha256, worksheets: [inspectCsvWorksheet(bytes, previewRowCount)] };
  }

  if (format === "xlsx") {
    await assertGuardedXlsxArchive(bytes);
  }

  const sheetNames = readSheetNamesOnly(bytes);
  assertWorksheetCount(sheetNames, limits);
  const worksheets = inspectSpreadsheetWorksheets(bytes, sheetNames, previewRowCount);
  return { format, sha256, worksheets };
}

function decodeCsvWorksheet(bytes: Uint8Array, index: number, limits: WorkbookLimits): DecodedWorksheet {
  if (index !== 0) {
    throw new WorkbookParserError("WORKSHEET_NOT_FOUND", "CSV input has exactly one worksheet, at index 0.", {
      worksheetIndex: index,
    });
  }
  const text = Buffer.from(bytes).toString("utf8");
  let table: unknown[][];
  try {
    table = parseCsvSync(text, { bom: true, relax_column_count: true }) as unknown[][];
  } catch (err) {
    throw new WorkbookParserError("MALFORMED_WORKBOOK", "The file could not be parsed as CSV.", undefined, err);
  }
  const headers = toHeaderStrings(table[0]);
  const rows = normalizeRows(table.slice(1));
  const columnCount = computeColumnExtent(headers, rows);
  const materializedCellCount = computeMaterializedCellCount(headers, rows);
  assertMaterializedLimits({ rowCount: rows.length, columnCount, materializedCellCount }, limits);
  return { index: 0, name: "CSV", visibility: "visible", headers, rows, rowCount: rows.length, columnCount };
}

// Authoritative check against what was actually decoded/returned. Used after
// materialization for both CSV and spreadsheet worksheets.
function assertMaterializedLimits(
  counts: { rowCount: number; columnCount: number; materializedCellCount: number },
  limits: WorkbookLimits
): void {
  if (counts.rowCount > limits.maxSelectedWorksheetRows) {
    throw new WorkbookParserError("WORKSHEET_LIMIT_EXCEEDED", "The selected worksheet has too many rows.", {
      limit: "maxSelectedWorksheetRows",
      maximum: limits.maxSelectedWorksheetRows,
      actual: counts.rowCount,
      basis: "materialized",
    });
  }
  if (counts.columnCount > limits.maxSelectedWorksheetColumns) {
    throw new WorkbookParserError("WORKSHEET_LIMIT_EXCEEDED", "The selected worksheet has too many columns.", {
      limit: "maxSelectedWorksheetColumns",
      maximum: limits.maxSelectedWorksheetColumns,
      actual: counts.columnCount,
      basis: "materialized",
    });
  }
  if (counts.materializedCellCount > limits.maxSelectedWorksheetCells) {
    throw new WorkbookParserError("WORKSHEET_LIMIT_EXCEEDED", "The selected worksheet has too many cells.", {
      limit: "maxSelectedWorksheetCells",
      maximum: limits.maxSelectedWorksheetCells,
      actual: counts.materializedCellCount,
      basis: "materialized",
    });
  }
}

// Early, cheap rejection from the workbook's DECLARED rectangular range,
// before any row is materialized. This is intentionally conservative — a
// preflight workload gate, not a measurement of real content — and is kept
// because it is a useful defense even though it can occasionally reject (or
// fail to reject) based on a declared range that doesn't match real data
// density. It shares the same limit constants as the authoritative
// post-decode check but is labeled `basis: "declaredRange"` in error details
// so the two are never confused with each other.
function assertDeclaredRangeLimits(
  range: { rows: number; columns: number },
  limits: WorkbookLimits
): void {
  const dataRows = Math.max(range.rows - 1, 0);
  if (dataRows > limits.maxSelectedWorksheetRows) {
    throw new WorkbookParserError("WORKSHEET_LIMIT_EXCEEDED", "The selected worksheet's declared range has too many rows.", {
      limit: "maxSelectedWorksheetRows",
      maximum: limits.maxSelectedWorksheetRows,
      actual: dataRows,
      basis: "declaredRange",
    });
  }
  if (range.columns > limits.maxSelectedWorksheetColumns) {
    throw new WorkbookParserError("WORKSHEET_LIMIT_EXCEEDED", "The selected worksheet's declared range has too many columns.", {
      limit: "maxSelectedWorksheetColumns",
      maximum: limits.maxSelectedWorksheetColumns,
      actual: range.columns,
      basis: "declaredRange",
    });
  }
  // A conservative rectangular estimate (rows x columns) — not the
  // materialized-cell definition used by assertMaterializedLimits — solely
  // to catch an extreme declared range before paying the cost to decode it.
  const conservativeCellEstimate = dataRows * range.columns;
  if (conservativeCellEstimate > limits.maxSelectedWorksheetCells) {
    throw new WorkbookParserError("WORKSHEET_LIMIT_EXCEEDED", "The selected worksheet's declared range implies too many cells.", {
      limit: "maxSelectedWorksheetCells",
      maximum: limits.maxSelectedWorksheetCells,
      actual: conservativeCellEstimate,
      basis: "declaredRange",
    });
  }
}

function decodeSpreadsheetWorksheet(
  bytes: Uint8Array,
  index: number,
  limits: WorkbookLimits
): DecodedWorksheet {
  const sheetNames = readSheetNamesOnly(bytes);
  assertWorksheetCount(sheetNames, limits);
  if (!Number.isInteger(index) || index < 0 || index >= sheetNames.length) {
    throw new WorkbookParserError("WORKSHEET_NOT_FOUND", "No worksheet exists at the given index.", {
      worksheetIndex: index,
    });
  }
  const name = sheetNames[index];

  let wb: XLSX.WorkBook;
  try {
    // CORRECTION (5A.2D): the `sheets` option limits which worksheet SheetJS
    // materializes into cell objects for xlsx — it does NOT limit ZIP
    // decompression. cfb (the ZIP reader xlsx bundles) decompresses every
    // entry in the archive unconditionally, before this option has any
    // effect at all (verified directly against the installed cfb source;
    // see the ADR's "5A.2D" section). This file's previous claim that xlsx
    // "genuinely decodes only the selected sheet" was true only for that
    // later materialization stage, never for decompression itself. The real
    // decompression-cost/safety boundary is assertGuardedXlsxArchive, run
    // before every xlsx call site in this module — by the time xlsxAdapter
    // .read runs here, the archive has already been proven safe to
    // decompress in full. For legacy xls (a single sequential BIFF8 stream,
    // not independently addressable ZIP entries), SheetJS parses the whole
    // stream regardless of this option either way — unaffected by 5A.2D,
    // since the archive guard is never applied to xls (see decodeWorksheet).
    wb = xlsxAdapter.read(bytes, { type: "buffer", sheets: [index], cellDates: true, cellHTML: false });
  } catch (err) {
    throw new WorkbookParserError(
      "MALFORMED_WORKBOOK",
      "The file could not be recognized as a valid workbook.",
      undefined,
      err
    );
  }
  const ws = wb.Sheets[name];
  if (!ws) {
    throw new WorkbookParserError("MALFORMED_WORKBOOK", "The selected worksheet could not be decoded.", {
      worksheetIndex: index,
    });
  }
  const visibilities = readVisibilities(wb, sheetNames.length);

  // Early rejection from declared range, before materializing rows — a
  // cheap, intentionally conservative signal (see assertDeclaredRangeLimits).
  const declaredRange = readDeclaredRange(ws);
  if (declaredRange) {
    assertDeclaredRangeLimits(declaredRange, limits);
  }

  const rowsAoA = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: null });
  const headers = toHeaderStrings(rowsAoA[0] as unknown[] | undefined);
  const rows = normalizeRows(rowsAoA.slice(1));
  const columnCount = computeColumnExtent(headers, rows);
  const materializedCellCount = computeMaterializedCellCount(headers, rows);
  // Authoritative check against what was actually materialized.
  assertMaterializedLimits({ rowCount: rows.length, columnCount, materializedCellCount }, limits);

  return {
    index,
    name,
    visibility: visibilities[index],
    headers,
    rows,
    rowCount: rows.length,
    columnCount,
  };
}

/**
 * Decodes exactly one worksheet, selected by its authoritative zero-based
 * index. Independent of inspectWorkbook — re-validates format/signature and
 * worksheet count itself, since it makes no assumption that inspection ran
 * first. Never falls back to worksheet 0 on an out-of-range index.
 *
 * Async (5A.2D): for "xlsx" input, the archive/decompression boundary must
 * resolve successfully before any SheetJS call, exactly as in
 * inspectWorkbook — this function is independent of inspectWorkbook and
 * therefore independently guarded; it never relies on inspectWorkbook
 * having run (or having validated the archive) first.
 */
export async function decodeWorksheet(
  bytes: Uint8Array,
  input: WorkbookInput,
  selection: WorksheetSelection,
  options: DecodeWorksheetOptions = {}
): Promise<DecodedWorksheet> {
  const limits: WorkbookLimits = { ...DEFAULT_WORKBOOK_LIMITS, ...options.limits };
  validateLimits(limits);

  if (bytes.byteLength > limits.maxOriginalBytes) {
    throw new WorkbookParserError("WORKBOOK_LIMIT_EXCEEDED", "The file exceeds the maximum allowed size.", {
      limit: "maxOriginalBytes",
      maximum: limits.maxOriginalBytes,
      actual: bytes.byteLength,
    });
  }

  const format = classifyFormat(input);
  validateSignature(format, bytes);

  if (format === "csv") {
    return decodeCsvWorksheet(bytes, selection.index, limits);
  }

  if (format === "xlsx") {
    await assertGuardedXlsxArchive(bytes);
  }

  return decodeSpreadsheetWorksheet(bytes, selection.index, limits);
}
