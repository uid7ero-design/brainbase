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

// A cell value whose first character is =, +, -, or @ can be interpreted
// as a formula by Excel/Sheets/LibreOffice when the CSV is opened (CSV/
// formula injection, CWE-1236) — RFC 4180 quoting alone does nothing to
// stop this, since none of those four characters trigger quoting on their
// own. Prefixing with a single quote is the standard mitigation: every
// spreadsheet application treats a leading `'` as "force this cell to
// plain text," which neutralizes the formula interpretation without
// altering the value a human reads. Every current caller of this helper
// (the events registrations export) passes either free text a public
// registrant fully controls (purchaser/attendee name, email, phone) or an
// already-formatted numeric string derived from a column with a real
// Postgres CHECK (total_cents >= 0) constraint (scripts/create-events-
// phase2.sql) — so it can never legitimately start with "-" — meaning
// this blanket guard cannot corrupt genuine numeric/spreadsheet semantics
// for any value this helper actually sees today.
function neutralizeFormulaPrefix(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

// A field needs quoting if it contains a comma, a double quote, or a
// line break (CR or LF) — RFC 4180 §2.6. An embedded double quote is
// escaped by doubling it (§2.7), inside the surrounding quote pair.
export function csvEscapeField(value: string): string {
  const safe = neutralizeFormulaPrefix(value);
  if (!/[",\r\n]/.test(safe)) return safe;
  return `"${safe.replace(/"/g, '""')}"`;
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
