// Small, explicit CSV serializer — this repo has no export-side CSV
// dependency (only csv-parse, used for import/ingestion elsewhere, e.g.
// lib/data-hub/csvOnlyDecoder.ts). RFC 4180 quoting is a short, well-
// understood algorithm; hand-rolling it here avoids adding a new
// dependency for something this small. CRLF line endings and a UTF-8
// BOM prefix are both included for broad spreadsheet-application
// compatibility (Excel in particular expects a BOM to render non-ASCII
// text correctly, and traditionally expects CRLF).

// String.fromCharCode(0xfeff) rather than a literal invisible character
// in source — unambiguous in any editor/diff, avoids any risk of an
// encoding tool silently stripping or mangling a literal BOM character
// sitting inside a source file.
const CSV_BOM = String.fromCharCode(0xfeff);

// A field needs quoting if it contains a comma, a double quote, or a
// line break (CR or LF) — RFC 4180 §2.6. An embedded double quote is
// escaped by doubling it (§2.7), inside the surrounding quote pair.
export function csvEscapeField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export type CsvCell = string | number | null | undefined;

export function buildCsvRow(fields: CsvCell[]): string {
  return fields.map(field => csvEscapeField(field === null || field === undefined ? '' : String(field))).join(',');
}

// header + rows in, one complete CSV document (with BOM, CRLF line
// endings, trailing CRLF) out.
export function buildCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [buildCsvRow(header), ...rows.map(buildCsvRow)];
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}
