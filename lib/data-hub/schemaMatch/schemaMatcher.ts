// Data Hub 6.2D3C — pure, deterministic governed XLSX structural matcher.
//
// matchObservedWorkbookStructure({ observed, governedSchema }) compares an
// observed workbook STRUCTURE (worksheet names/indices/visibility/emptiness
// and, for governed sheets only, one exact header row) against one governed
// source schema version and returns a deterministic SchemaMatchReport. It is a
// pure function: no I/O, no Prisma, no clock, no randomness, no locale-
// sensitive comparison. It never sees data rows, sample values, formulas,
// Definitions prose, filenames, users or timestamps, and it never infers
// equivalence semantically or fuzzily.
//
// RULES (D3C v1):
//   Worksheet identity is the exact, case-sensitive expected_name only.
//   ordinal_hint is informational — physical order alone is never drift.
//   A renamed sheet is therefore one missing governed + one unexpected
//   observed sheet; WORKSHEET_NAME_MISMATCH is reserved and never emitted
//   (no deterministic alias exists in D3C v1).
//
//   A governed worksheet is MATCHED only when exactly one observed sheet
//   carries its exact name AND that sheet is visible and non-empty. Present
//   but hidden/empty -> SHEET_UNMATCHABLE (severity follows the governed
//   presence, like a missing sheet). Present more than once ->
//   SHEET_UNMATCHABLE per occurrence, always BLOCKING (ambiguous identity).
//   Every observed sheet — hidden and empty included — whose name matches
//   no governed worksheet is UNEXPECTED_WORKSHEET.
//
//   Columns are compared only for a MATCHED governed worksheet that defines
//   columns (a zero-column governed sheet such as Trends matches by name
//   only; no column equality is claimed and none is invented). Identity is
//   by ordinal: observed header N must equal governed source_header N
//   exactly (spelling, case, punctuation and whitespace significant) and the
//   counts must be equal. Precedence per worksheet, each position explained
//   at most once:
//     0. header row not resolvable (no governed header row, row absent/
//        blank, or fewer than HALF of the governed header positions have
//        their literal text anywhere in the row) ->
//        a single HEADER_ROW_UNRESOLVED (BLOCKING); no per-column output, so
//        a row that is not a header row is never echoed.
//        Declared width beyond parser limits -> STRUCTURAL_LIMIT_EXCEEDED.
//     1. positions whose headers are equal are exact — no output.
//     2. a header text that is duplicated in governed or observed (and is
//        governed) whose ordinal SET differs -> one
//        DUPLICATE_HEADER_SHAPE_CHANGED for that text (BLOCKING when any of
//        its governed positions would block — REQUIRED, or schema not
//        DRAFT — else WARNING); every unequal
//        position carrying that text on either side is explained by it.
//        Duplicates are never collapsed by name.
//     3. a header text occurring exactly once governed and exactly once
//        observed, at different ordinals -> COLUMN_POSITION_CHANGED.
//     4. remaining governed ordinal N with remaining observed ordinal N ->
//        COLUMN_HEADER_CHANGED.
//     5. remaining governed ordinals -> MISSING_{REQUIRED,OPTIONAL}_COLUMN.
//     6. remaining observed ordinals -> UNEXPECTED_COLUMN.
//
// Severity: missing REQUIRED sheet/column, HEADER_ROW_UNRESOLVED,
// STRUCTURAL_LIMIT_EXCEEDED, MATCHER_INTERNAL_ERROR and duplicate governed
// sheet occurrences are BLOCKING. Everything else is WARNING, except
// COLUMN_HEADER_CHANGED and DUPLICATE_HEADER_SHAPE_CHANGED, which are
// WARNING only while the schema is DRAFT and the affected governed
// column(s) OPTIONAL (BLOCKING otherwise).
//
// Result: UNMATCHABLE when no governed worksheet could be matched at all
// (or the governed schema defines none, or the matcher failed internally);
// else BLOCKING_DRIFT / MATCH_WITH_NON_BLOCKING_DRIFT / EXACT_MATCH.
// EXACT_MATCH is a STRUCTURAL statement only — never acceptance, approval,
// activation, lineage selection or import readiness.

export type SchemaMatchResult = "EXACT_MATCH" | "MATCH_WITH_NON_BLOCKING_DRIFT" | "BLOCKING_DRIFT" | "UNMATCHABLE";

export type SchemaDifferenceCode =
  | "MISSING_REQUIRED_WORKSHEET"
  | "MISSING_OPTIONAL_WORKSHEET"
  | "UNEXPECTED_WORKSHEET"
  | "WORKSHEET_NAME_MISMATCH"
  | "MISSING_REQUIRED_COLUMN"
  | "MISSING_OPTIONAL_COLUMN"
  | "UNEXPECTED_COLUMN"
  | "COLUMN_HEADER_CHANGED"
  | "COLUMN_POSITION_CHANGED"
  | "DUPLICATE_HEADER_SHAPE_CHANGED"
  | "HEADER_ROW_UNRESOLVED"
  | "SHEET_UNMATCHABLE"
  | "STRUCTURAL_LIMIT_EXCEEDED"
  | "MATCHER_INTERNAL_ERROR";

export type SchemaDifferenceSeverity = "INFO" | "WARNING" | "BLOCKING";

export type GovernedPresence = "REQUIRED" | "OPTIONAL";

export interface SchemaDifference {
  code: SchemaDifferenceCode;
  severity: SchemaDifferenceSeverity;
  worksheetLogicalKey: string | null;
  governedWorksheetName: string | null;
  observedWorksheetName: string | null;
  governedWorksheetOrdinalHint: number | null;
  observedWorksheetIndex: number | null;
  governedColumnOrdinal: number | null;
  observedColumnOrdinal: number | null;
  governedHeader: string | null;
  /** Observed header-row text only; null for a blank/non-text cell. */
  observedHeader: string | null;
  governedPresence: GovernedPresence | null;
  messageKey: string;
  deterministicKey: string;
}

export interface SchemaMatchReport {
  reportVersion: 1;
  sourceSchemaVersionId: string;
  sourceSchemaVersionNumber: number;
  sourceSchemaStatus: string;
  result: SchemaMatchResult;
  exactMatch: boolean;
  blocking: boolean;
  observedWorksheetCount: number;
  governedWorksheetCount: number;
  matchedWorksheetCount: number;
  missingRequiredWorksheetCount: number;
  missingOptionalWorksheetCount: number;
  unexpectedWorksheetCount: number;
  totalDifferenceCount: number;
  blockingDifferenceCount: number;
  warningDifferenceCount: number;
  differences: SchemaDifference[];
}

export interface GovernedColumnInput {
  ordinal: number;
  sourceHeader: string;
  presence: GovernedPresence;
}

export interface GovernedWorksheetInput {
  logicalKey: string;
  expectedName: string;
  ordinalHint: number | null;
  presence: GovernedPresence;
  /** One-based governed header row; null when the sheet has no tabular header. */
  headerRowOneBased: number | null;
  columns: GovernedColumnInput[];
}

export interface GovernedSchemaInput {
  sourceSchemaVersionId: string;
  versionNumber: number;
  status: string;
  worksheets: GovernedWorksheetInput[];
}

export type ObservedHeaderRow =
  | { status: "notRead" }
  | { status: "ok"; cells: (string | null)[] }
  | { status: "rowAbsent" }
  | { status: "limitExceeded" }
  | { status: "ambiguous" };

export interface ObservedWorksheetInput {
  index: number;
  name: string;
  visibility: "visible" | "hidden" | "veryHidden";
  isEmpty: boolean;
  headerRow: ObservedHeaderRow;
}

export interface ObservedWorkbookInput {
  worksheets: ObservedWorksheetInput[];
}

export interface HeaderRowReadPlanEntry {
  index: number;
  headerRowOneBased: number;
}

const MESSAGE_KEYS: Record<SchemaDifferenceCode, string> = {
  MISSING_REQUIRED_WORKSHEET: "dataHub.schemaMatch.missingRequiredWorksheet",
  MISSING_OPTIONAL_WORKSHEET: "dataHub.schemaMatch.missingOptionalWorksheet",
  UNEXPECTED_WORKSHEET: "dataHub.schemaMatch.unexpectedWorksheet",
  WORKSHEET_NAME_MISMATCH: "dataHub.schemaMatch.worksheetNameMismatch",
  MISSING_REQUIRED_COLUMN: "dataHub.schemaMatch.missingRequiredColumn",
  MISSING_OPTIONAL_COLUMN: "dataHub.schemaMatch.missingOptionalColumn",
  UNEXPECTED_COLUMN: "dataHub.schemaMatch.unexpectedColumn",
  COLUMN_HEADER_CHANGED: "dataHub.schemaMatch.columnHeaderChanged",
  COLUMN_POSITION_CHANGED: "dataHub.schemaMatch.columnPositionChanged",
  DUPLICATE_HEADER_SHAPE_CHANGED: "dataHub.schemaMatch.duplicateHeaderShapeChanged",
  HEADER_ROW_UNRESOLVED: "dataHub.schemaMatch.headerRowUnresolved",
  SHEET_UNMATCHABLE: "dataHub.schemaMatch.sheetUnmatchable",
  STRUCTURAL_LIMIT_EXCEEDED: "dataHub.schemaMatch.structuralLimitExceeded",
  MATCHER_INTERNAL_ERROR: "dataHub.schemaMatch.matcherInternalError",
};

export const SCHEMA_DIFFERENCE_CODES = Object.keys(MESSAGE_KEYS) as readonly SchemaDifferenceCode[];

type DifferenceFields = Partial<Omit<SchemaDifference, "code" | "severity" | "messageKey" | "deterministicKey">>;

function difference(code: SchemaDifferenceCode, severity: SchemaDifferenceSeverity, fields: DifferenceFields): SchemaDifference {
  // Fixed key order so JSON serialization is byte-stable.
  const d = {
    code,
    severity,
    worksheetLogicalKey: fields.worksheetLogicalKey ?? null,
    governedWorksheetName: fields.governedWorksheetName ?? null,
    observedWorksheetName: fields.observedWorksheetName ?? null,
    governedWorksheetOrdinalHint: fields.governedWorksheetOrdinalHint ?? null,
    observedWorksheetIndex: fields.observedWorksheetIndex ?? null,
    governedColumnOrdinal: fields.governedColumnOrdinal ?? null,
    observedColumnOrdinal: fields.observedColumnOrdinal ?? null,
    governedHeader: fields.governedHeader ?? null,
    observedHeader: fields.observedHeader ?? null,
    governedPresence: fields.governedPresence ?? null,
    messageKey: MESSAGE_KEYS[code],
    deterministicKey: "",
  };
  // Structural identity only (never the observed header text): JSON array
  // encoding makes any delimiter inside a name/header unambiguous.
  d.deterministicKey = JSON.stringify([
    d.code,
    d.worksheetLogicalKey,
    d.observedWorksheetIndex,
    d.governedColumnOrdinal,
    d.observedColumnOrdinal,
    d.governedHeader,
  ]);
  return d;
}

function nullsLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareDifferences(a: SchemaDifference, b: SchemaDifference): number {
  return (
    nullsLast(a.governedWorksheetOrdinalHint, b.governedWorksheetOrdinalHint) ||
    nullsLast(a.observedWorksheetIndex, b.observedWorksheetIndex) ||
    nullsLast(a.governedColumnOrdinal, b.governedColumnOrdinal) ||
    nullsLast(a.observedColumnOrdinal, b.observedColumnOrdinal) ||
    ordinalCompare(a.code, b.code) ||
    ordinalCompare(a.deterministicKey, b.deterministicKey)
  );
}

function isValidPresence(value: unknown): value is GovernedPresence {
  return value === "REQUIRED" || value === "OPTIONAL";
}

/** Structural self-consistency of one governed worksheet definition. */
function governedWorksheetIsValid(ws: GovernedWorksheetInput): boolean {
  if (!isValidPresence(ws.presence)) return false;
  if (ws.headerRowOneBased !== null && !(Number.isSafeInteger(ws.headerRowOneBased) && ws.headerRowOneBased >= 1)) return false;
  const ordinals = ws.columns.map((c) => c.ordinal).sort((a, b) => a - b);
  if (!ordinals.every((o, i) => o === i)) return false;
  return ws.columns.every((c) => typeof c.sourceHeader === "string" && isValidPresence(c.presence));
}

function groupByName<T extends { name: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.name);
    if (list) list.push(item);
    else map.set(item.name, [item]);
  }
  return map;
}

function isEligible(ws: ObservedWorksheetInput): boolean {
  return ws.visibility === "visible" && !ws.isEmpty;
}

/**
 * Which observed worksheets need their governed header row read: exactly
 * those that will be MATCHED to a governed worksheet defining columns with
 * a governed header row. Unexpected, hidden, empty and duplicate-named
 * sheets are never read. Sorted by index.
 */
export function planHeaderRowReads(
  observed: Pick<ObservedWorksheetInput, "index" | "name" | "visibility" | "isEmpty">[],
  governedSchema: GovernedSchemaInput
): HeaderRowReadPlanEntry[] {
  const byName = groupByName(observed as ObservedWorksheetInput[]);
  const governedByName = groupByName(governedSchema.worksheets.map((g) => ({ name: g.expectedName })));
  const plan: HeaderRowReadPlanEntry[] = [];
  for (const g of governedSchema.worksheets) {
    if (governedByName.get(g.expectedName)?.length !== 1) continue;
    const hits = byName.get(g.expectedName) ?? [];
    if (hits.length !== 1 || !isEligible(hits[0])) continue;
    if (g.columns.length === 0 || g.headerRowOneBased === null || !governedWorksheetIsValid(g)) continue;
    plan.push({ index: hits[0].index, headerRowOneBased: g.headerRowOneBased });
  }
  return plan.sort((a, b) => a.index - b.index);
}

function compareColumns(
  g: GovernedWorksheetInput,
  o: ObservedWorksheetInput,
  cells: (string | null)[],
  schemaIsDraft: boolean
): SchemaDifference[] {
  const base: DifferenceFields = {
    worksheetLogicalKey: g.logicalKey,
    governedWorksheetName: g.expectedName,
    observedWorksheetName: o.name,
    governedWorksheetOrdinalHint: g.ordinalHint,
    observedWorksheetIndex: o.index,
  };
  const governed = [...g.columns].sort((a, b) => a.ordinal - b.ordinal);
  const gh = governed.map((c) => c.sourceHeader);
  // A data row that happens to share one cell with a governed header must
  // never qualify as the header row (its other cells would be echoed as
  // observed headers), so at least half of the governed positions must find
  // their literal text somewhere in the row.
  const observedTexts = new Set(cells.filter((cell): cell is string => cell !== null));
  const overlap = gh.filter((h) => observedTexts.has(h)).length;
  if (overlap * 2 < gh.length) {
    return [difference("HEADER_ROW_UNRESOLVED", "BLOCKING", base)];
  }

  const n = gh.length;
  const m = cells.length;
  const gOpen = new Set<number>();
  const oOpen = new Set<number>();
  for (let i = 0; i < Math.max(n, m); i++) {
    const equal = i < n && i < m && gh[i] === cells[i];
    if (!equal && i < n) gOpen.add(i);
    if (!equal && i < m) oOpen.add(i);
  }
  const out: SchemaDifference[] = [];

  const gPositions = new Map<string, number[]>();
  gh.forEach((h, i) => gPositions.set(h, [...(gPositions.get(h) ?? []), i]));
  const oPositions = new Map<string, number[]>();
  cells.forEach((h, j) => {
    if (h !== null) oPositions.set(h, [...(oPositions.get(h) ?? []), j]);
  });

  // 2. Duplicate header shape (governed texts only, in first-governed order).
  for (const [text, gs] of gPositions) {
    const os = oPositions.get(text) ?? [];
    if (gs.length < 2 && os.length < 2) continue;
    const sameShape = gs.length === os.length && gs.every((p, k) => p === os[k]);
    if (sameShape) continue;
    const blocks = !schemaIsDraft || gs.some((p) => governed[p].presence === "REQUIRED");
    out.push(
      difference("DUPLICATE_HEADER_SHAPE_CHANGED", blocks ? "BLOCKING" : "WARNING", {
        ...base,
        governedHeader: text,
        governedPresence: governed[gs[0]].presence,
      })
    );
    for (const p of gs) gOpen.delete(p);
    for (const p of os) oOpen.delete(p);
  }

  // 3. Unique header moved.
  for (const [text, gs] of gPositions) {
    const os = oPositions.get(text) ?? [];
    if (gs.length !== 1 || os.length !== 1 || gs[0] === os[0]) continue;
    if (!gOpen.has(gs[0]) || !oOpen.has(os[0])) continue;
    out.push(
      difference("COLUMN_POSITION_CHANGED", "WARNING", {
        ...base,
        governedColumnOrdinal: gs[0],
        observedColumnOrdinal: os[0],
        governedHeader: text,
        observedHeader: text,
        governedPresence: governed[gs[0]].presence,
      })
    );
    gOpen.delete(gs[0]);
    oOpen.delete(os[0]);
  }

  // 4/5. Changed header at the same ordinal, else missing.
  for (const i of [...gOpen].sort((a, b) => a - b)) {
    const col = governed[i];
    if (oOpen.has(i)) {
      out.push(
        difference("COLUMN_HEADER_CHANGED", schemaIsDraft && col.presence === "OPTIONAL" ? "WARNING" : "BLOCKING", {
          ...base,
          governedColumnOrdinal: i,
          observedColumnOrdinal: i,
          governedHeader: col.sourceHeader,
          observedHeader: cells[i],
          governedPresence: col.presence,
        })
      );
      oOpen.delete(i);
    } else {
      const required = col.presence === "REQUIRED";
      out.push(
        difference(required ? "MISSING_REQUIRED_COLUMN" : "MISSING_OPTIONAL_COLUMN", required ? "BLOCKING" : "WARNING", {
          ...base,
          governedColumnOrdinal: i,
          governedHeader: col.sourceHeader,
          governedPresence: col.presence,
        })
      );
    }
  }

  // 6. Unexpected observed columns.
  for (const j of [...oOpen].sort((a, b) => a - b)) {
    out.push(difference("UNEXPECTED_COLUMN", "WARNING", { ...base, observedColumnOrdinal: j, observedHeader: cells[j] }));
  }
  return out;
}

interface Tally {
  differences: SchemaDifference[];
  matched: number;
  missingRequired: number;
  missingOptional: number;
  unexpected: number;
}

function matchCore(observed: ObservedWorkbookInput, governedSchema: GovernedSchemaInput): Tally {
  const schemaIsDraft = governedSchema.status === "DRAFT";
  const tally: Tally = { differences: [], matched: 0, missingRequired: 0, missingOptional: 0, unexpected: 0 };
  const push = (d: SchemaDifference) => tally.differences.push(d);
  const observedByName = groupByName(observed.worksheets);
  const governedByName = groupByName(governedSchema.worksheets.map((g) => ({ ...g, name: g.expectedName })));

  for (const g of governedSchema.worksheets) {
    const base: DifferenceFields = {
      worksheetLogicalKey: g.logicalKey,
      governedWorksheetName: g.expectedName,
      governedWorksheetOrdinalHint: g.ordinalHint,
      governedPresence: isValidPresence(g.presence) ? g.presence : null,
    };
    if (!governedWorksheetIsValid(g) || (governedByName.get(g.expectedName)?.length ?? 0) !== 1) {
      push(difference("MATCHER_INTERNAL_ERROR", "BLOCKING", base));
      continue;
    }
    const required = g.presence === "REQUIRED";
    const hits = observedByName.get(g.expectedName) ?? [];

    if (hits.length === 0) {
      if (required) tally.missingRequired++;
      else tally.missingOptional++;
      push(difference(required ? "MISSING_REQUIRED_WORKSHEET" : "MISSING_OPTIONAL_WORKSHEET", required ? "BLOCKING" : "WARNING", base));
      continue;
    }
    if (hits.length > 1) {
      for (const o of hits) {
        push(difference("SHEET_UNMATCHABLE", "BLOCKING", { ...base, observedWorksheetName: o.name, observedWorksheetIndex: o.index }));
      }
      continue;
    }
    const o = hits[0];
    const sheetBase = { ...base, observedWorksheetName: o.name, observedWorksheetIndex: o.index };
    if (!isEligible(o)) {
      push(difference("SHEET_UNMATCHABLE", required ? "BLOCKING" : "WARNING", sheetBase));
      continue;
    }
    tally.matched++;
    if (g.columns.length === 0) continue;
    if (g.headerRowOneBased === null) {
      push(difference("HEADER_ROW_UNRESOLVED", "BLOCKING", sheetBase));
      continue;
    }
    switch (o.headerRow.status) {
      case "ok":
        for (const d of compareColumns(g, o, o.headerRow.cells, schemaIsDraft)) push(d);
        break;
      case "rowAbsent":
        push(difference("HEADER_ROW_UNRESOLVED", "BLOCKING", sheetBase));
        break;
      case "limitExceeded":
        push(difference("STRUCTURAL_LIMIT_EXCEEDED", "BLOCKING", sheetBase));
        break;
      case "ambiguous":
        push(difference("SHEET_UNMATCHABLE", "BLOCKING", sheetBase));
        break;
      default:
        // "notRead": the caller did not honor planHeaderRowReads.
        push(difference("MATCHER_INTERNAL_ERROR", "BLOCKING", sheetBase));
    }
  }

  for (const o of observed.worksheets) {
    if (governedByName.has(o.name)) continue;
    tally.unexpected++;
    push(difference("UNEXPECTED_WORKSHEET", "WARNING", { observedWorksheetName: o.name, observedWorksheetIndex: o.index }));
  }
  return tally;
}

function buildReport(governedSchema: GovernedSchemaInput, observedCount: number, tally: Tally, forceUnmatchable: boolean): SchemaMatchReport {
  const differences = [...tally.differences].sort(compareDifferences);
  const blockingDifferenceCount = differences.filter((d) => d.severity === "BLOCKING").length;
  const warningDifferenceCount = differences.filter((d) => d.severity === "WARNING").length;
  const governedWorksheetCount = Array.isArray(governedSchema?.worksheets) ? governedSchema.worksheets.length : 0;
  const unmatchable = forceUnmatchable || governedWorksheetCount === 0 || tally.matched === 0;
  const result: SchemaMatchResult = unmatchable
    ? "UNMATCHABLE"
    : blockingDifferenceCount > 0
      ? "BLOCKING_DRIFT"
      : differences.length > 0
        ? "MATCH_WITH_NON_BLOCKING_DRIFT"
        : "EXACT_MATCH";
  return {
    reportVersion: 1,
    sourceSchemaVersionId: String(governedSchema?.sourceSchemaVersionId ?? ""),
    sourceSchemaVersionNumber: Number(governedSchema?.versionNumber ?? 0),
    sourceSchemaStatus: String(governedSchema?.status ?? ""),
    result,
    exactMatch: result === "EXACT_MATCH",
    blocking: result === "UNMATCHABLE" || result === "BLOCKING_DRIFT",
    observedWorksheetCount: observedCount,
    governedWorksheetCount,
    matchedWorksheetCount: tally.matched,
    missingRequiredWorksheetCount: tally.missingRequired,
    missingOptionalWorksheetCount: tally.missingOptional,
    unexpectedWorksheetCount: tally.unexpected,
    totalDifferenceCount: differences.length,
    blockingDifferenceCount,
    warningDifferenceCount,
    differences,
  };
}

export function matchObservedWorkbookStructure(input: {
  observed: ObservedWorkbookInput;
  governedSchema: GovernedSchemaInput;
}): SchemaMatchReport {
  const { observed, governedSchema } = input;
  try {
    return buildReport(governedSchema, observed.worksheets.length, matchCore(observed, governedSchema), false);
  } catch {
    // Never echo the thrown error (it could quote observed text).
    const tally: Tally = {
      differences: [difference("MATCHER_INTERNAL_ERROR", "BLOCKING", {})],
      matched: 0,
      missingRequired: 0,
      missingOptional: 0,
      unexpected: 0,
    };
    return buildReport(governedSchema, Array.isArray(observed?.worksheets) ? observed.worksheets.length : 0, tally, true);
  }
}
