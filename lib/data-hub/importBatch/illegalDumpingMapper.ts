// Data Hub 5A.2K.1 — canonical (DATA_HUB) illegal-dumping row mapper.
//
// Reuses only the VALUE-level mapping semantics from the legacy pipeline's
// modules/dumping/index.ts (parseDate/nullStr/parseFloatOrNull/mapSeverity/
// mapStatus) — copied here deliberately rather than imported, so this
// canonical path never depends on modules/dumping/index.ts's own
// filesystem-based, non-transactional implementation. Two legacy quirks
// are explicitly NOT inherited:
//   1. modules/dumping/index.ts hardcodes `parseFile(buffer, "text/csv",
//      stored_path)` regardless of the upload's real declared format —
//      this canonical path is CSV-only by explicit precondition (checked
//      by the caller, confirmWorksheet.ts, against the ImportBatch's own
//      trusted content_type before this module is ever reached), never by
//      a hardcoded assumption.
//   2. modules/dumping/index.ts accepts an arbitrary caller-supplied
//      `fieldMappings` object with no format/shape validation. This dark
//      service has no HTTP caller and therefore no UI-driven field-mapping
//      step yet (a future, separate concern) — canonical CSV headers are
//      matched by FIXED, exact name instead, never by caller-supplied
//      indirection, which also means this module can never be tricked into
//      reading an unexpected column merely because a caller's mapping
//      object said so.

export const ILLEGAL_DUMPING_REQUIRED_HEADERS = ["report_date", "location", "waste_type"] as const;

export const ILLEGAL_DUMPING_KNOWN_HEADERS = [
  "report_date",
  "location",
  "suburb",
  "zone",
  "waste_type",
  "volume_estimate",
  "severity",
  "status",
  "crew_assigned",
  "resolution_date",
  "cost_estimate",
  "notes",
] as const;

export interface MappedIllegalDumpingRow {
  report_date: Date;
  location: string;
  suburb: string | null;
  zone: string | null;
  waste_type: string;
  volume_estimate: string | null;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  crew_assigned: string | null;
  resolution_date: Date | null;
  cost_estimate: number | null;
  notes: string | null;
}

export class IllegalDumpingMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalDumpingMappingError";
  }
}

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function nullStr(v: string | undefined): string | null {
  const s = v != null ? v.trim() : "";
  return s || null;
}
function parseFloatOrNull(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function mapSeverity(s: string | null): MappedIllegalDumpingRow["severity"] {
  switch (s?.toLowerCase()) {
    case "critical":
      return "CRITICAL";
    case "high":
      return "HIGH";
    case "low":
      return "LOW";
    default:
      return "MEDIUM";
  }
}
function mapStatus(s: string): MappedIllegalDumpingRow["status"] {
  const l = s.toLowerCase().replace(/[\s_]+/g, "_");
  if (l === "resolved" || l === "closed" || l === "complete") return "RESOLVED";
  if (l.includes("progress")) return "IN_PROGRESS";
  return "OPEN";
}

/**
 * Validates the CSV header row contains every required canonical column
 * exactly once, by exact, fixed name — never a caller-supplied mapping.
 * Throws IllegalDumpingMappingError (never a partial/best-effort result) if
 * any required header is absent OR duplicated.
 *
 * DUPLICATE-HEADER HARDENING (5A.3A): mapIllegalDumpingRows' column index is
 * built as `new Map(headers.map((h, i) => [h, i]))`, which silently keeps
 * only the LAST occurrence's column index for any header name that appears
 * more than once. That is never a wrong-FIELD misdirection (lookup is by
 * exact header name, never position), but it silently substitutes a value
 * from the wrong physical column into a correctly-identified required
 * field whenever a hand-edited CSV (e.g. an Excel copy-paste) produces a
 * duplicate required header — a genuinely reachable authoring mistake, not
 * merely theoretical. This check runs BEFORE the ambiguous Map is ever
 * built (mapIllegalDumpingRows calls this function first), so the ambiguity
 * itself is rejected outright — this is intentionally NOT a "do the
 * duplicate values disagree?" check: even a duplicate required header whose
 * two occurrences hold byte-identical values is rejected, because the
 * ambiguity of WHICH occurrence a future edit would land in is the actual
 * defect, independent of today's values.
 *
 * Duplicate identity uses the exact same string identity as the missing-
 * header check above and as mapIllegalDumpingRows' own column-index Map
 * (`headers.includes(h)` / exact `===`) — no separate trim/case
 * normalization is introduced here, since decodeCsvOnly (csvOnlyDecoder.ts)
 * never trims or case-folds header text before this function ever sees it,
 * and inventing a second, divergent normalization scheme here would make
 * "duplicate" mean something different than "matches" does everywhere else
 * in this module.
 *
 * SCOPE: required headers (report_date, location, waste_type) only. A
 * duplicated OPTIONAL header (e.g. two "severity" columns) has the same
 * last-occurrence-wins mechanism but is deliberately out of scope for this
 * hardening pass — see the Data Hub 5A.3A implementation report for the
 * explicit investigation and rationale.
 */
export function validateIllegalDumpingHeaders(headers: string[]): void {
  const missing = ILLEGAL_DUMPING_REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    throw new IllegalDumpingMappingError(
      `CSV is missing required column(s) for illegal dumping import: ${missing.join(", ")}.`
    );
  }
  const duplicated = ILLEGAL_DUMPING_REQUIRED_HEADERS.filter(
    (h) => headers.filter((header) => header === h).length > 1
  );
  if (duplicated.length > 0) {
    throw new IllegalDumpingMappingError(
      `CSV has duplicate required column(s) for illegal dumping import: ${duplicated.join(", ")}. Each required column must appear exactly once.`
    );
  }
}

/**
 * Maps decoded CSV rows (header + data rows) into canonical illegal-dumping
 * domain row shapes. Every row is validated independently; the FIRST
 * invalid row throws immediately (never a partial/best-effort mapped set)
 * — the caller (confirmWorksheet.ts) is responsible for ensuring this
 * entire function runs, and either fully succeeds or is entirely
 * discarded, before any transaction opens.
 */
export function mapIllegalDumpingRows(headers: string[], rows: string[][]): MappedIllegalDumpingRow[] {
  validateIllegalDumpingHeaders(headers);
  const colIndex = new Map(headers.map((h, i) => [h, i]));
  const get = (row: string[], name: string): string | undefined => {
    const idx = colIndex.get(name);
    return idx === undefined ? undefined : row[idx];
  };

  return rows.map((row, rowIndex) => {
    const reportDate = parseDate(get(row, "report_date"));
    const location = nullStr(get(row, "location"));
    const wasteType = nullStr(get(row, "waste_type"));
    if (!reportDate) {
      throw new IllegalDumpingMappingError(`Row ${rowIndex + 1}: "report_date" is missing or not a valid date.`);
    }
    if (!location) {
      throw new IllegalDumpingMappingError(`Row ${rowIndex + 1}: "location" is required.`);
    }
    if (!wasteType) {
      throw new IllegalDumpingMappingError(`Row ${rowIndex + 1}: "waste_type" is required.`);
    }
    return {
      report_date: reportDate,
      location,
      suburb: nullStr(get(row, "suburb")),
      zone: nullStr(get(row, "zone")),
      waste_type: wasteType,
      volume_estimate: nullStr(get(row, "volume_estimate")),
      severity: mapSeverity(nullStr(get(row, "severity"))),
      status: mapStatus(get(row, "status") ?? "open"),
      crew_assigned: nullStr(get(row, "crew_assigned")),
      resolution_date: parseDate(get(row, "resolution_date")),
      cost_estimate: parseFloatOrNull(get(row, "cost_estimate")),
      notes: nullStr(get(row, "notes")),
    };
  });
}
