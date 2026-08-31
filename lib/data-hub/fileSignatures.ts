// Data Hub 5A.2G.1 — xlsx-free file format/signature primitives.
//
// Mechanically extracted from lib/data-hub/workbookParser.ts (Phase
// 5A.2G.1 discovery + architecture review): workbookParser.ts imports
// `xlsx` (SheetJS) unconditionally at module top level, even though format
// classification, signature validation, and NUL-byte detection have never
// actually depended on SheetJS at all — they are pure filename/byte
// inspection. This module carries exactly those xlsx-independent pieces so
// a future consumer (namely lib/data-hub/importBatch/finalize.ts) can
// reuse them for format-preflight WITHOUT pulling xlsx into its import
// graph — see that module's own header comment for why that boundary is a
// hard security requirement, not a style preference.
//
// CONTRACT: this module MUST NOT import `xlsx`, MUST NOT import
// workbookParser.ts, and MUST NOT import anything that itself transitively
// imports xlsx. It has zero imports at all beyond nothing (the checks
// below need no npm dependency). This is verified both by a static
// containment test (tests/containment/fileSignatures.test.ts) and by
// this module simply never writing an import statement for one.
//
// workbookParser.ts now imports these exact functions/constants FROM this
// module instead of owning duplicate definitions — see that file's own
// updated header comment. Its externally-observable behavior is
// byte-for-byte unchanged by this extraction (existing tests continue to
// pass unmodified).

export type WorkbookFormat = "csv" | "xls" | "xlsx";

export const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
export const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * Raw byte-signature matcher: true iff `bytes` is at least as long as
 * `signature` and every leading byte matches exactly.
 */
export function matchesSignature(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

/**
 * True iff `bytes` contains at least one NUL (0x00) byte — the cheap,
 * pre-parse signal used to reject obviously-binary content masquerading
 * as CSV (CSV itself has no magic-byte signature to check instead).
 */
export function containsNulByte(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

export interface WorkbookFormatInput {
  /** Original filename, used to classify format. Required. */
  filename: string;
}

export type FileSignatureErrorCode = "UNSUPPORTED_FILE_TYPE" | "INVALID_FILE_SIGNATURE";

export class FileSignatureError extends Error {
  readonly code: FileSignatureErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: FileSignatureErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "FileSignatureError";
    this.code = code;
    this.details = details;
  }
}

// Format is classified from filename/extension only. MIME is intentionally
// never consulted here — a browser-supplied MIME type is untrusted advisory
// metadata, not a basis for deciding how to parse the bytes.
export function classifyFormat(input: WorkbookFormatInput): WorkbookFormat {
  const match = /\.([a-z0-9]+)$/i.exec(input.filename.trim());
  const extension = match?.[1]?.toLowerCase();
  if (extension === "csv") return "csv";
  if (extension === "xls") return "xls";
  if (extension === "xlsx") return "xlsx";
  throw new FileSignatureError(
    "UNSUPPORTED_FILE_TYPE",
    "Only .csv, .xls, and .xlsx files are supported.",
    { extension: extension ?? null }
  );
}

// Signature validation rejects an obviously wrong file cheaply, before any
// parsing is attempted. It is necessary but NOT sufficient on its own for
// xlsx: every ZIP file shares the same local-file-header signature — a
// genuinely valid ZIP that is not an OOXML workbook still passes this check
// and is only rejected once structural workbook recognition fails (that
// later stage lives in workbookParser.ts, not here).
export function validateSignature(format: WorkbookFormat, bytes: Uint8Array): void {
  if (format === "xlsx") {
    if (!matchesSignature(bytes, ZIP_SIGNATURE)) {
      throw new FileSignatureError(
        "INVALID_FILE_SIGNATURE",
        "The file does not have a valid XLSX (ZIP) signature.",
        { expectedFormat: "xlsx" }
      );
    }
    return;
  }
  if (format === "xls") {
    if (!matchesSignature(bytes, OLE_SIGNATURE)) {
      throw new FileSignatureError(
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
    throw new FileSignatureError(
      "INVALID_FILE_SIGNATURE",
      "The file contains binary content and cannot be parsed as CSV.",
      { expectedFormat: "csv" }
    );
  }
}
