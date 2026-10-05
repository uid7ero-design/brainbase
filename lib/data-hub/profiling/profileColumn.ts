// Data Hub 6.2D4D1A — pure, per-column structural profiling.
//
// Validates one ProfileColumnInput against rowCount, then (only if valid)
// computes its ColumnProfile. Fails closed on any malformed input — the
// caller (profileDataset) never receives a partial/best-effort profile for
// an invalid column, and no value is ever echoed back in the failure.

import { VALUE_KINDS, UNITS, type ValueKind, type Unit } from "../schemaProfiles/profileDocument";
import type { BooleanColumnStats, ColumnProfile, NormalizedScalar, NumericColumnStats, ProfileCellInput, ProfileColumnInput, StringColumnStats, TemporalColumnStats } from "./contracts";
import { aggregateExactDecimalStrings, decimalToCanonicalString, isWholeExactDecimal, parseStrictDecimalString } from "./decimal";
import { exactCountRatioString, exactDecimalMeanString } from "./ratio";
import { canonicalTemporalKey, compareCanonicalTemporal } from "./temporal";
import { isCanonicalNormalizedDate, isCanonicalNormalizedDateTime, isCanonicalNormalizedTime, hasMixedDatetimeZoneForms } from "./temporalValidation";
import { isSafeNonNegativeInteger, SafeAccumulator } from "./safeInt";

const VALUE_KIND_SET: ReadonlySet<string> = new Set(VALUE_KINDS);
const UNIT_SET: ReadonlySet<string> = new Set(UNITS);

const STRING_LIKE_KINDS: ReadonlySet<ValueKind> = new Set(["STRING", "IDENTIFIER"]);
const NUMERIC_LIKE_KINDS: ReadonlySet<ValueKind> = new Set(["INTEGER", "DECIMAL", "DURATION", "PERCENTAGE", "CURRENCY", "LATITUDE", "LONGITUDE"]);
const TEMPORAL_KINDS: ReadonlySet<ValueKind> = new Set(["DATE", "TIME", "DATETIME"]);

export type ColumnValidationResult = { ok: true } | { ok: false };

function isValidUnit(u: Unit | null): boolean {
  return u === null || UNIT_SET.has(u);
}

/**
 * Canonical (not merely shape-matching) validation — see
 * temporalValidation.ts. A regex can accept impossible calendar/clock
 * values (2025-02-30, 25:00:00); this re-parses with D4C-B2A's own real
 * grammar/calendar parser and requires the canonical re-render to equal
 * the input exactly, which additionally rejects accepted-but-non-
 * canonical RAW input forms (B2A's DATE midnight-timestamp accommodation,
 * TIME's short "HH:mm" form, a numeric DATETIME source offset).
 */
function isCanonicalValueForKind(kind: ValueKind, value: string): boolean {
  if (kind === "DATE") return isCanonicalNormalizedDate(value);
  if (kind === "TIME") return isCanonicalNormalizedTime(value);
  if (kind === "DATETIME") return isCanonicalNormalizedDateTime(value);
  return true;
}

/**
 * Structural (never business-meaning) validation of one column against
 * the declared rowCount — see contracts.ts's PROFILE_INPUT_ERROR_CODES
 * doc comment for what "malformed" covers.
 */
export function validateColumnInput(column: ProfileColumnInput, rowCount: number): ColumnValidationResult {
  if (!isSafeNonNegativeInteger(rowCount)) return { ok: false };
  if (typeof column.sourceSchemaColumnId !== "string" || column.sourceSchemaColumnId.length === 0) return { ok: false };
  if (!VALUE_KIND_SET.has(column.valueKind)) return { ok: false };
  if (!isValidUnit(column.sourceUnit) || !isValidUnit(column.normalizedUnit)) return { ok: false };
  if (!Array.isArray(column.cells) || column.cells.length > rowCount) return { ok: false };

  const seenRowNumbers = new Set<number>();
  for (const cell of column.cells) {
    if (!cellShapeOk(cell, column.valueKind, rowCount, seenRowNumbers)) return { ok: false };
    seenRowNumbers.add(cell.sourceRowNumber);
  }

  // A single normalized DATETIME column is governed by exactly one
  // timeZonePolicy — it can never legitimately mix trailing-"Z" and
  // non-"Z" values. Checked only after every individual value has already
  // passed canonical shape validation above.
  if (column.valueKind === "DATETIME") {
    const nonNullStrings = column.cells.filter((c) => c.normalizedValue !== null).map((c) => c.normalizedValue as string);
    if (hasMixedDatetimeZoneForms(nonNullStrings)) return { ok: false };
  }

  return { ok: true };
}

function cellShapeOk(cell: ProfileCellInput, valueKind: ValueKind, rowCount: number, seenRowNumbers: ReadonlySet<number>): boolean {
  if (!isSafeNonNegativeInteger(cell.sourceRowNumber) || cell.sourceRowNumber < 1 || cell.sourceRowNumber > rowCount) return false;
  if (seenRowNumbers.has(cell.sourceRowNumber)) return false;
  return isValueShapeValid(valueKind, cell.normalizedValue);
}

function isValueShapeValid(valueKind: ValueKind, value: NormalizedScalar): boolean {
  if (value === null) return true;
  if (valueKind === "BOOLEAN") return typeof value === "boolean";
  if (typeof value !== "string") return false;
  if (STRING_LIKE_KINDS.has(valueKind)) return true;
  if (TEMPORAL_KINDS.has(valueKind)) return isCanonicalValueForKind(valueKind, value);
  if (NUMERIC_LIKE_KINDS.has(valueKind)) {
    const parsed = parseStrictDecimalString(value);
    if (!parsed) return false;
    if (valueKind === "INTEGER" && !isWholeExactDecimal(parsed)) return false;
    return true;
  }
  return false;
}

function codePointLength(s: string): number {
  return Array.from(s).length;
}

export type ProfileColumnResult = { ok: true; profile: ColumnProfile; nonNullRowNumbers: ReadonlySet<number> } | { ok: false };

/**
 * Caller must have already validated the column via validateColumnInput().
 * Can still fail closed here (ok:false) if an aggregation (e.g. STRING
 * total code-point length) would silently exceed Number.MAX_SAFE_INTEGER —
 * a safety condition distinct from, and checked after, shape validity.
 */
export function profileColumn(column: ProfileColumnInput, rowCount: number): ProfileColumnResult {
  const nonNullCells = column.cells.filter((c) => c.normalizedValue !== null);
  const nonNullCount = nonNullCells.length;
  // Safe plain subtraction: rowCount is already a validated safe integer,
  // and nonNullCount <= column.cells.length <= rowCount always, so the
  // result is exactly representable with no BigInt needed.
  const nullCount = rowCount - nonNullCount;
  const nonNullRowNumbers = new Set<number>(nonNullCells.map((c) => c.sourceRowNumber));

  const distinctNonNullCount = computeDistinctNonNullCount(column.valueKind, nonNullCells);

  const isAllNull = rowCount > 0 && nonNullCount === 0;
  const isComplete = nullCount === 0;
  const isSparse = rowCount > 0 && nonNullCount > 0 && nonNullCount < rowCount;
  const isConstant = distinctNonNullCount === 1;
  const isUniqueAmongNonNull = nonNullCount > 0 && distinctNonNullCount === nonNullCount;

  const profile: ColumnProfile = {
    sourceSchemaColumnId: column.sourceSchemaColumnId,
    valueKind: column.valueKind,
    sourceUnit: column.sourceUnit,
    normalizedUnit: column.normalizedUnit,
    rowCount,
    nonNullCount,
    nullCount,
    distinctNonNullCount,
    nullRatio: exactCountRatioString(nullCount, rowCount),
    nonNullRatio: exactCountRatioString(nonNullCount, rowCount),
    distinctRatio: exactCountRatioString(distinctNonNullCount, nonNullCount),
    isConstant,
    isAllNull,
    isUniqueAmongNonNull,
    isComplete,
    isSparse,
  };

  if (STRING_LIKE_KINDS.has(column.valueKind)) {
    const stats = buildStringStats(nonNullCells);
    if (!stats.ok) return { ok: false };
    profile.stringStats = stats.value;
  } else if (column.valueKind === "BOOLEAN") {
    profile.booleanStats = buildBooleanStats(nonNullCells, nullCount);
  } else if (NUMERIC_LIKE_KINDS.has(column.valueKind)) {
    profile.numericStats = buildNumericStats(nonNullCells);
  } else if (TEMPORAL_KINDS.has(column.valueKind)) {
    profile.temporalStats = buildTemporalStats(nonNullCells);
  }

  return { ok: true, profile, nonNullRowNumbers };
}

function computeDistinctNonNullCount(valueKind: ValueKind, nonNullCells: readonly ProfileCellInput[]): number {
  if (nonNullCells.length === 0) return 0;
  if (valueKind === "BOOLEAN") {
    const set = new Set<boolean>(nonNullCells.map((c) => c.normalizedValue as boolean));
    return set.size;
  }
  if (NUMERIC_LIKE_KINDS.has(valueKind)) {
    // Dedupe by the EXACT value, not the raw string — "2.50" and "2.5" are
    // the same value and must collapse to one. parseStrictDecimalString
    // already normalizes (strips trailing zeros), so re-rendering it is a
    // stable canonical key.
    const set = new Set<string>();
    for (const c of nonNullCells) {
      const parsed = parseStrictDecimalString(c.normalizedValue as string);
      // Caller has already validated shape; parsed is never null here.
      set.add(`${parsed!.negative ? "-" : ""}${parsed!.digits.toString()}/${parsed!.scale}`);
    }
    return set.size;
  }
  if (TEMPORAL_KINDS.has(valueKind)) {
    const set = new Set<string>(nonNullCells.map((c) => canonicalTemporalKey(c.normalizedValue as string)));
    return set.size;
  }
  // STRING / IDENTIFIER — exact string identity, no normalization.
  const set = new Set<string>(nonNullCells.map((c) => c.normalizedValue as string));
  return set.size;
}

function buildStringStats(nonNullCells: readonly ProfileCellInput[]): { ok: true; value: StringColumnStats } | { ok: false } {
  if (nonNullCells.length === 0) {
    return { ok: true, value: { minLength: 0, maxLength: 0, totalLength: 0, meanLength: null, emptyStringCount: 0 } };
  }
  let minLength = Number.POSITIVE_INFINITY;
  let maxLength = 0;
  let emptyStringCount = 0;
  const totalLengthAcc = new SafeAccumulator();
  for (const cell of nonNullCells) {
    const value = cell.normalizedValue as string;
    const len = codePointLength(value);
    if (len < minLength) minLength = len;
    if (len > maxLength) maxLength = len;
    totalLengthAcc.add(len);
    if (value === "") emptyStringCount += 1;
  }
  const totalLengthResult = totalLengthAcc.result();
  if (!totalLengthResult.ok) return { ok: false };
  const totalLength = totalLengthResult.value;
  return {
    ok: true,
    value: {
      minLength,
      maxLength,
      totalLength,
      meanLength: exactCountRatioString(totalLength, nonNullCells.length),
      emptyStringCount,
    },
  };
}

function buildBooleanStats(nonNullCells: readonly ProfileCellInput[], nullCount: number): BooleanColumnStats {
  let trueCount = 0;
  let falseCount = 0;
  for (const cell of nonNullCells) {
    if (cell.normalizedValue === true) trueCount += 1;
    else falseCount += 1;
  }
  return { trueCount, falseCount, nullCount };
}

function buildNumericStats(nonNullCells: readonly ProfileCellInput[]): NumericColumnStats {
  if (nonNullCells.length === 0) {
    return { min: null, max: null, sum: null, mean: null };
  }
  const result = aggregateExactDecimalStrings(nonNullCells.map((c) => c.normalizedValue as string));
  // Caller has already validated every cell's shape, so this always
  // succeeds — defensive fallback only, never reached in practice. Exact
  // BigInt-backed decimal arithmetic has no Number.MAX_SAFE_INTEGER
  // boundary at all, so no overflow-failure path is needed here.
  if (!result.ok) return { min: null, max: null, sum: null, mean: null };
  return {
    min: decimalToCanonicalString(result.min),
    max: decimalToCanonicalString(result.max),
    sum: decimalToCanonicalString(result.sum),
    mean: exactDecimalMeanString(result.sum, nonNullCells.length),
  };
}

function buildTemporalStats(nonNullCells: readonly ProfileCellInput[]): TemporalColumnStats {
  if (nonNullCells.length === 0) {
    return { min: null, max: null };
  }
  let min = nonNullCells[0].normalizedValue as string;
  let max = min;
  for (const cell of nonNullCells) {
    const value = cell.normalizedValue as string;
    if (compareCanonicalTemporal(value, min) < 0) min = value;
    if (compareCanonicalTemporal(value, max) > 0) max = value;
  }
  return { min, max };
}
