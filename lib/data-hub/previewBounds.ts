// Data Hub 6.2D2 — the single set of RESPONSE-only preview bounds, shared by
// the CSV preview (importBatch/previewWorksheet.ts, 5A.3C.0 — values moved
// here verbatim, unchanged) and the XLSX worksheet preview
// (importBatch/previewXlsxWorksheet.ts). They bound only the SERIALIZED
// payload a human is shown — never the underlying decoder's own work, which
// each format's decoder bounds independently.
//
// Pure, dependency-free: no xlsx, no Prisma, no storage — safe for the
// xlsx-free CSV preview path to import.

export const PREVIEW_MAX_SAMPLE_ROWS = 20;
export const PREVIEW_MAX_SAMPLE_COLUMNS = 50;
export const PREVIEW_MAX_CELL_CHARS = 200;

export function truncateCell(cell: string): string {
  return cell.length > PREVIEW_MAX_CELL_CHARS ? `${cell.slice(0, PREVIEW_MAX_CELL_CHARS)}…(truncated)` : cell;
}

export function boundColumns(row: string[]): string[] {
  return row.slice(0, PREVIEW_MAX_SAMPLE_COLUMNS).map(truncateCell);
}
