import { createHash } from "node:crypto";
import { parse as parseCsvSync } from "csv-parse/sync";
import * as XLSX from "xlsx";

// Data Hub workbook parsing/identity foundation (Phase 5A.1).
//
// This module knows only raw workbook/file semantics: format classification,
// signature validation, content-addressable identity (SHA-256), worksheet
// inventory, and bounded/selected worksheet decoding. It deliberately does
// NOT know about BrainBase schema detection, column mapping, canonical
// import semantics, persistence, or storage — see lib/schema-detector.ts and
// lib/column-mapper.ts for that layer, which consumes the plain rows this
// module returns.

export type WorkbookFormat = "csv" | "xls" | "xlsx";

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
  | "WORKSHEET_NOT_FOUND";

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
  /** Total cells (rows x columns) a single *selected* worksheet may materialize. */
  maxSelectedWorksheetCells: number;
}

// Approved 5A.1 defaults. These bound a single application's ingestion
// workload — they are not a claim about safe enterprise-scale limits, and
// (per the accompanying ADR) they do not defend against malicious archive
// decompression: SheetJS remains a fully in-memory parser regardless of
// these values.
export const DEFAULT_WORKBOOK_LIMITS: WorkbookLimits = {
  maxOriginalBytes: 20 * 1024 * 1024, // 20 MiB
  maxWorksheetCount: 50,
  maxSelectedWorksheetRows: 100_000,
  maxSelectedWorksheetColumns: 1_000,
  maxSelectedWorksheetCells: 2_000_000,
};

export const DEFAULT_PREVIEW_ROW_COUNT = 10;

export interface WorksheetInspection {
  /** Zero-based, authoritative for later selection via decodeWorksheet. */
  index: number;
  /** Descriptive only — never used to select a worksheet. */
  name: string;
  visibility: WorksheetVisibility;
  isEmpty: boolean;
  /**
   * The workbook's *declared* dimension for this sheet (from the sheet's
   * dimension metadata), not a guarantee of actually-populated rows/columns.
   * Undefined for CSV, which has no equivalent declaration.
   */
  declaredRangeRows?: number;
  declaredRangeColumns?: number;
  headers: string[];
  /** Bounded to at most the configured preview row count. */
  previewRows: unknown[][];
  /** True when this worksheet has more data rows than the preview shows. */
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
  columnCount: number;
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function matchesSignature(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

function containsNulByte(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

// Format is classified from filename/extension only. MIME is intentionally
// never consulted here — a browser-supplied MIME type is untrusted advisory
// metadata, not a basis for deciding how to parse the bytes.
function classifyFormat(input: WorkbookInput): WorkbookFormat {
  const match = /\.([a-z0-9]+)$/i.exec(input.filename.trim());
  const extension = match?.[1]?.toLowerCase();
  if (extension === "csv") return "csv";
  if (extension === "xls") return "xls";
  if (extension === "xlsx") return "xlsx";
  throw new WorkbookParserError(
    "UNSUPPORTED_FILE_TYPE",
    "Only .csv, .xls, and .xlsx files are supported.",
    { extension: extension ?? null }
  );
}

// Signature validation rejects an obviously wrong file cheaply, before any
// parsing is attempted. It is necessary but NOT sufficient on its own for
// xlsx: every ZIP file shares the same local-file-header signature, so a
// generic ZIP renamed .xlsx still passes this check and is only rejected
// once structural workbook recognition fails (see readSheetNamesOnly).
function validateSignature(format: WorkbookFormat, bytes: Uint8Array): void {
  if (format === "xlsx") {
    if (!matchesSignature(bytes, ZIP_SIGNATURE)) {
      throw new WorkbookParserError(
        "INVALID_FILE_SIGNATURE",
        "The file does not have a valid XLSX (ZIP) signature.",
        { expectedFormat: "xlsx" }
      );
    }
    return;
  }
  if (format === "xls") {
    if (!matchesSignature(bytes, OLE_SIGNATURE)) {
      throw new WorkbookParserError(
        "INVALID_FILE_SIGNATURE",
        "The file does not have a valid legacy XLS (OLE) signature.",
        { expectedFormat: "xls" }
      );
    }
    return;
  }
  // CSV has no magic-byte signature. The closest equivalent pre-parse gate
  // is rejecting content that is obviously not text.
  if (containsNulByte(bytes)) {
    throw new WorkbookParserError(
      "INVALID_FILE_SIGNATURE",
      "The file contains binary content and cannot be parsed as CSV.",
      { expectedFormat: "csv" }
    );
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

// Cheap, decode-free pass: sheet names and count only. Used to reject an
// excessive worksheet count before any cell data is materialized.
function readSheetNamesOnly(bytes: Uint8Array): string[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: "buffer", bookSheets: true });
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

function toHeaderStrings(row: unknown[] | undefined): string[] {
  if (!row) return [];
  return row.map((value) => (value === null || value === undefined ? "" : String(value)));
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
  const previewRows = dataRows.slice(0, previewRowCount);
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

function inspectSpreadsheetWorksheets(
  bytes: Uint8Array,
  sheetNames: string[],
  previewRowCount: number
): WorksheetInspection[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, {
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

  return sheetNames.map((name, index) => {
    const ws = wb.Sheets[name];
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
      previewRows: rowsAoA.slice(1, previewRowCount + 1),
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
 */
export function inspectWorkbook(
  bytes: Uint8Array,
  input: WorkbookInput,
  options: InspectWorkbookOptions = {}
): WorkbookInspection {
  const limits: WorkbookLimits = { ...DEFAULT_WORKBOOK_LIMITS, ...options.limits };
  const previewRowCount = options.previewRowCount ?? DEFAULT_PREVIEW_ROW_COUNT;

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
  const rows = table.slice(1);
  assertSelectedWorksheetLimits({ rowCount: rows.length, columnCount: headers.length }, limits);
  return { index: 0, name: "CSV", visibility: "visible", headers, rows, rowCount: rows.length, columnCount: headers.length };
}

function assertSelectedWorksheetLimits(
  counts: { rowCount: number; columnCount: number },
  limits: WorkbookLimits
): void {
  if (counts.rowCount > limits.maxSelectedWorksheetRows) {
    throw new WorkbookParserError("WORKSHEET_LIMIT_EXCEEDED", "The selected worksheet has too many rows.", {
      limit: "maxSelectedWorksheetRows",
      maximum: limits.maxSelectedWorksheetRows,
      actual: counts.rowCount,
    });
  }
  if (counts.columnCount > limits.maxSelectedWorksheetColumns) {
    throw new WorkbookParserError("WORKSHEET_LIMIT_EXCEEDED", "The selected worksheet has too many columns.", {
      limit: "maxSelectedWorksheetColumns",
      maximum: limits.maxSelectedWorksheetColumns,
      actual: counts.columnCount,
    });
  }
  const cellCount = counts.rowCount * counts.columnCount;
  if (cellCount > limits.maxSelectedWorksheetCells) {
    throw new WorkbookParserError("WORKSHEET_LIMIT_EXCEEDED", "The selected worksheet has too many cells.", {
      limit: "maxSelectedWorksheetCells",
      maximum: limits.maxSelectedWorksheetCells,
      actual: cellCount,
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
    // For xlsx (ZIP-entry-based), this genuinely decodes only the selected
    // sheet. For legacy xls (a single sequential BIFF8 stream), SheetJS
    // still parses the whole stream internally regardless of this option —
    // documented in the ADR, not claimed otherwise here.
    wb = XLSX.read(bytes, { type: "buffer", sheets: [index], cellDates: true, cellHTML: false });
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
  // cheap signal, not an authoritative one (see readDeclaredRange).
  const declaredRange = readDeclaredRange(ws);
  if (declaredRange) {
    assertSelectedWorksheetLimits(
      { rowCount: Math.max(declaredRange.rows - 1, 0), columnCount: declaredRange.columns },
      limits
    );
  }

  const rowsAoA = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: null });
  const headers = toHeaderStrings(rowsAoA[0] as unknown[] | undefined);
  const rows = rowsAoA.slice(1);
  // Authoritative check against what was actually materialized.
  assertSelectedWorksheetLimits({ rowCount: rows.length, columnCount: headers.length }, limits);

  return {
    index,
    name,
    visibility: visibilities[index],
    headers,
    rows,
    rowCount: rows.length,
    columnCount: headers.length,
  };
}

/**
 * Decodes exactly one worksheet, selected by its authoritative zero-based
 * index. Independent of inspectWorkbook — re-validates format/signature and
 * worksheet count itself, since it makes no assumption that inspection ran
 * first. Never falls back to worksheet 0 on an out-of-range index.
 */
export function decodeWorksheet(
  bytes: Uint8Array,
  input: WorkbookInput,
  selection: WorksheetSelection,
  options: DecodeWorksheetOptions = {}
): DecodedWorksheet {
  const limits: WorkbookLimits = { ...DEFAULT_WORKBOOK_LIMITS, ...options.limits };

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
  return decodeSpreadsheetWorksheet(bytes, selection.index, limits);
}
