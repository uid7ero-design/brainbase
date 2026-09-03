// Data Hub 5A.2K.1 — xlsx-free CSV-only decode primitive.
//
// Deliberately independent of lib/data-hub/workbookParser.ts. That module
// imports `xlsx` (SheetJS) unconditionally at top level — even though its
// own CSV branch (decodeCsvWorksheet) never calls into SheetJS at runtime,
// merely importing workbookParser.ts still loads the xlsx package into the
// process's module graph. lib/data-hub/importBatch/confirmWorksheet.ts (the
// canonical DATA_HUB worksheet confirmation service, dark, CSV-scoped for
// this phase) must NOT carry that transitive dependency — see this repo's
// existing lib/data-hub/fileSignatures.ts for the exact same precedent
// ("mechanically extracted... so a future consumer can reuse them WITHOUT
// pulling xlsx into its import graph") and lib/data-hub/importBatch/
// finalize.ts's own header comment for why this is a hard security
// requirement, not a style preference: keeping the canonical import path
// import-free of xlsx keeps the standing xlsx@0.18.5 public-parser-exposure
// question entirely irrelevant to this dark service, regardless of how it
// is eventually resolved.
//
// CONTRACT: this module MUST NOT import `xlsx`, MUST NOT import
// workbookParser.ts, and MUST NOT import anything that itself transitively
// imports either. tests/containment/confirmWorksheet.test.ts statically
// enforces this.
//
// Row/column/cell limits are intentionally DUPLICATED from workbookParser's
// own DEFAULT_WORKBOOK_LIMITS rather than imported, for the same reason —
// re-verify both sets of numbers agree before relying on this as a hard
// guarantee (matches the identical, already-established caveat on
// lib/data-hub/importBatch/read.ts's own WORKSHEET_LIST_DEFENSIVE_BOUND).

import { parse as parseCsvSync } from "csv-parse/sync";

/** Duplicated from workbookParser.ts's DEFAULT_WORKBOOK_LIMITS — see module header. */
export const CSV_ONLY_LIMITS = {
  maxSelectedWorksheetRows: 100_000,
  maxSelectedWorksheetColumns: 1_000,
  maxSelectedWorksheetCells: 2_000_000,
} as const;

export class CsvOnlyDecodeError extends Error {
  readonly code: "MALFORMED_CSV" | "LIMIT_EXCEEDED";
  constructor(code: "MALFORMED_CSV" | "LIMIT_EXCEEDED", message: string) {
    super(message);
    this.name = "CsvOnlyDecodeError";
    this.code = code;
  }
}

export interface DecodedCsvTable {
  headers: string[];
  rows: string[][];
}

function toHeaderStrings(row: unknown[] | undefined): string[] {
  if (!row) return [];
  return row.map((cell) => (cell == null ? "" : String(cell)));
}

/**
 * Decodes raw CSV bytes into a header row + data rows, entirely independent
 * of SheetJS. Mirrors workbookParser.ts's own decodeCsvWorksheet logic
 * (bom-aware, relaxed column count, materialized-limit enforcement) without
 * importing that module.
 */
export function decodeCsvOnly(bytes: Uint8Array): DecodedCsvTable {
  const text = Buffer.from(bytes).toString("utf8");
  let table: unknown[][];
  try {
    table = parseCsvSync(text, { bom: true, relax_column_count: true }) as unknown[][];
  } catch {
    throw new CsvOnlyDecodeError("MALFORMED_CSV", "The file could not be parsed as CSV.");
  }
  const headers = toHeaderStrings(table[0]);
  const rows = table.slice(1).map((row) => (row as unknown[]).map((cell) => (cell == null ? "" : String(cell))));

  if (rows.length > CSV_ONLY_LIMITS.maxSelectedWorksheetRows) {
    throw new CsvOnlyDecodeError("LIMIT_EXCEEDED", "The CSV has too many rows.");
  }
  const columnCount = Math.max(headers.length, ...rows.map((r) => r.length), 0);
  if (columnCount > CSV_ONLY_LIMITS.maxSelectedWorksheetColumns) {
    throw new CsvOnlyDecodeError("LIMIT_EXCEEDED", "The CSV has too many columns.");
  }
  if (rows.length * columnCount > CSV_ONLY_LIMITS.maxSelectedWorksheetCells) {
    throw new CsvOnlyDecodeError("LIMIT_EXCEEDED", "The CSV has too many cells.");
  }

  return { headers, rows };
}
