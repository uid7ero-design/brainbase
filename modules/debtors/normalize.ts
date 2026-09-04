// Phase C1-DBI — shared Debtors source normalization.
//
// Context: Phase C1-DBS2 added six nullable, additive typed/source-
// preservation columns to debtor_accounts (financial_year,
// financial_quarter, charge_type, invoice_date, source_book,
// source_charge_code) and backfilled them for existing rows via
// scripts/add-debtor-charge-line-columns.ts. That backfill script encodes
// the one and only approved normalization policy for these six fields
// (see its own header comment) — this module is that SAME policy,
// re-expressed as plain TypeScript so it can run at WRITE time, in both
// modules/debtors/index.ts (the generic in-app importer) and
// scripts/ingest-from-folders.ts (the legacy bootstrap script), without
// either duplicating the rules independently or drifting from the
// already-approved SQL backfill's behaviour.
//
// Every function here follows the same "never guess" discipline the
// backfill script established: an unrecognized source shape produces
// `null`, never an approximated/best-effort value. Nothing here ever
// throws — a single malformed field must not fail an entire import.

export interface DebtorTypedFields {
  financial_year: string | null;
  financial_quarter: string | null;
  charge_type: string | null;
  invoice_date: Date | null;
  source_book: string | null;
  source_charge_code: string | null;
}

export interface DebtorRawSourceFields {
  source_book?: unknown;        // raw bookname cell, e.g. "2324MISC"
  source_charge_code?: unknown; // raw chargecode cell
  financial_quarter?: unknown;  // raw quarter cell, e.g. "Q2"
  invoice_date?: unknown;       // raw invoice date cell — Date (xlsx cellDates) or string (csv)
}

export interface DebtorNormalizationCounts {
  unrecognized_bookname: number;
  invalid_quarter: number;
  unparseable_invoice_date: number;
  blank_chargecode: number;
}

export function emptyNormalizationCounts(): DebtorNormalizationCounts {
  return { unrecognized_bookname: 0, invalid_quarter: 0, unparseable_invoice_date: 0, blank_chargecode: 0 };
}

function trimmedOrNull(v: unknown): string | null {
  const s = v != null ? String(v).trim() : "";
  return s || null;
}

// financial_year: ONLY the exact `^(\d{2})(\d{2})MISC$` bookname shape
// observed in real data (e.g. "2324MISC" -> "2023-24"). Mirrors
// scripts/add-debtor-charge-line-columns.ts Step 5 exactly. A bookname
// with any other shape is left null, not approximated.
const BOOKNAME_FY_PATTERN = /^([0-9]{2})([0-9]{2})MISC$/;

export function normalizeFinancialYear(bookname: unknown): string | null {
  const s = trimmedOrNull(bookname);
  if (!s) return null;
  const m = BOOKNAME_FY_PATTERN.exec(s);
  return m ? `20${m[1]}-${m[2]}` : null;
}

// financial_quarter: ONLY an exact Q1-Q4 match. Mirrors the backfill's
// Step 4 exactly.
const QUARTER_PATTERN = /^Q[1-4]$/;

export function normalizeFinancialQuarter(quarter: unknown): string | null {
  const s = trimmedOrNull(quarter);
  if (!s) return null;
  return QUARTER_PATTERN.test(s) ? s : null;
}

// charge_type / source_charge_code: both are the SAME verbatim,
// non-enum copy of the raw source chargecode (the backfill's Steps 2-3
// set them to the identical value from metadata.chargecode) — text
// preservation, never a mapped/normalized enum.
export function normalizeChargeCode(chargecode: unknown): string | null {
  return trimmedOrNull(chargecode);
}

export function normalizeSourceBook(bookname: unknown): string | null {
  return trimmedOrNull(bookname);
}

// invoice_date: ONLY a strict, unambiguous shape — either an already-
// parsed JS Date (xlsx reads with cellDates:true produce these for
// genuine spreadsheet date cells) or a string beginning with an
// ISO-8601 date prefix (mirrors the backfill's own
// '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' regex, relaxed
// only to allow a date without a time component, since a plain
// `new Date(...)` call cannot fail as $queryRaw's stricter Postgres CAST
// could). A bare number (a possible unconverted Excel serial) is
// deliberately NOT interpreted — guessing an epoch without evidence this
// importer's raw rows ever carry an unconverted serial would violate the
// "never guess" rule this whole module follows.
const ISO_DATE_PREFIX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}/;

export function normalizeInvoiceDate(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!ISO_DATE_PREFIX.test(s)) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// The one entry point both ingestion paths call — takes whatever raw
// source values a row provides and returns all six typed fields,
// normalized identically regardless of caller.
export function normalizeDebtorSourceFields(raw: DebtorRawSourceFields): DebtorTypedFields {
  const source_book = normalizeSourceBook(raw.source_book);
  const source_charge_code = normalizeChargeCode(raw.source_charge_code);
  return {
    source_book,
    source_charge_code,
    charge_type: source_charge_code,
    financial_quarter: normalizeFinancialQuarter(raw.financial_quarter),
    financial_year: normalizeFinancialYear(source_book),
    invoice_date: normalizeInvoiceDate(raw.invoice_date),
  };
}

// Aggregate, PII-free observability (Phase C1-DBI §7). Callers accumulate
// this across every row of an import and log ONE summary line — never a
// per-row/per-account log, which could leak individual debtor data.
export function tallyNormalizationFailure(
  counts: DebtorNormalizationCounts,
  raw: DebtorRawSourceFields,
  fields: DebtorTypedFields,
): void {
  if (fields.financial_year == null && trimmedOrNull(raw.source_book) != null) {
    counts.unrecognized_bookname++;
  }
  if (fields.financial_quarter == null && trimmedOrNull(raw.financial_quarter) != null) {
    counts.invalid_quarter++;
  }
  if (fields.invoice_date == null && raw.invoice_date != null && raw.invoice_date !== "") {
    counts.unparseable_invoice_date++;
  }
  if (fields.source_charge_code == null) {
    counts.blank_chargecode++;
  }
}
