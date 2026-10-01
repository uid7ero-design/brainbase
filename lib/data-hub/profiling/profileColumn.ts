// Data Hub 6.2D4D1A — pure, per-column structural profiling.
//
// Validates one ProfileColumnInput against rowCount, then (only if valid)
// computes its ColumnProfile. Fails closed on any malformed input — the
// caller (profileDataset) never receives a partial/best-effort profile for
// an invalid column, and no value is ever echoed back in the failure.

import { VALUE_KINDS, UNITS, type ValueKind, type Unit } from "../schemaProfiles/profileDocument";
import type { ColumnProfile, NormalizedScalar, ProfileCellInput, ProfileColumnInput } from "./contracts";
import { aggregateExactDecimalStrings, decimalToCanonicalString, isWholeExactDecimal, parseStrictDecimalString } from "./decimal";
import { exactCountRatioString, exactDecimalMeanString } from "./ratio";
import { canonicalTemporalKey, compareCanonicalTemporal } from "./temporal";

const VALUE_KIND_SET: ReadonlySet<string> = new Set(VALUE_KINDS);
const UNIT_SET: ReadonlySet<string> = new Set(UNITS);

const STRING_LIKE_KINDS: ReadonlySet<ValueKind> = new Set(["STRING", "IDENTIFIER"]);
const NUMERIC_LIKE_KINDS: ReadonlySet<ValueKind> = new Set(["INTEGER", "DECIMAL", "DURATION", "PERCENTAGE", "CURRENCY", "LATITUDE", "LONGITUDE"]);
const TEMPORAL_KINDS: ReadonlySet<ValueKind> = new Set(["DATE", "TIME", "DATETIME"]);

const DATE_SHAPE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIME_SHAPE_RE = /^[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?$/;
const DATETIME_SHAPE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z?$/;

export type ColumnValidationResult = { ok: true } | { ok: false };

function isValidUnit(u: Unit | null): boolean {
  return u === null || UNIT_SET.has(u);
}

function isShapeValidForKind(kind: ValueKind, value: string): boolean {
  if (kind === "DATE") return DATE_SHAPE_RE.test(value);
  if (kind === "TIME") return TIME_SHAPE_RE.test(value);
  if (kind === "DATETIME") return DATETIME_SHAPE_RE.test(value);
  return true;
}

/**
 * Structural (never business-meaning) validation of one column against
 * the declared rowCount — see contracts.ts's PROFILE_INPUT_ERROR_CODES
 * doc comment for what "malformed" covers.
 */
export function validateColumnInput(column: ProfileColumnInput, rowCount: number): ColumnValidationResult {
  if (!Number.isInteger(rowCount) || rowCount < 0) return { ok: false };
  if (typeof column.sourceSchemaColumnId !== "string" || column.sourceSchemaColumnId.length === 0) return { ok: false };
  if (!VALUE_KIND_SET.has(column.valueKind)) return { ok: false };
  if (!isValidUnit(column.sourceUnit) || !isValidUnit(column.normalizedUnit)) return { ok: false };
  if (!Array.isArray(column.cells) || column.cells.length > rowCount) return { ok: false };

  const seenRowNumbers = new Set<number>();
  for (const cell of column.cells) {
    if (!cellShapeOk(cell, column.valueKind, rowCount, seenRowNumbers)) return { ok: false };
    seenRowNumbers.add(cell.sourceRowNumber);
  }
  return { ok: true };
}

function cellShapeOk(cell: ProfileCellInput, valueKind: ValueKind, rowCount: number, seenRowNumbers: ReadonlySet<number>): boolean {
  if (!Number.isInteger(cell.sourceRowNumber) || cell.sourceRowNumber < 1 || cell.sourceRowNumber > rowCount) return false;
  if (seenRowNumbers.has(cell.sourceRowNumber)) return false;
  return isValueShapeValid(valueKind, cell.normalizedValue);
}

function isValueShapeValid(valueKind: ValueKind, value: NormalizedScalar): boolean {
  if (value === null) return true;
  if (valueKind === "BOOLEAN") return typeof value === "boolean";
  if (typeof value !== "string") return false;
  if (STRING_LIKE_KINDS.has(valueKind)) return true;
  if (TEMPORAL_KINDS.has(valueKind)) return isShapeValidForKind(valueKind, value);
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

/** Caller must have already validated the column via validateColumnInput(). */
export function profileColumn(column: ProfileColumnInput, rowCount: number): { profile: ColumnProfile; nonNullRowNumbers: ReadonlySet<number> } {
  const nonNullCells = column.cells.filter((c) => c.normalizedValue !== null);
  const nonNullCount = nonNullCells.length;
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
    profile.stringStats = buildStringStats(nonNullCells);
  } else if (column.valueKind === "BOOLEAN") {
    profile.booleanStats = buildBooleanStats(nonNullCells, nullCount);
  } else if (NUMERIC_LIKE_KINDS.has(column.valueKind)) {
    profile.numericStats = buildNumericStats(nonNullCells);
  } else if (TEMPORAL_KINDS.has(column.valueKind)) {
    profile.temporalStats = buildTemporalStats(nonNullCells);
  }

  return { profile, nonNullRowNumbers };
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

function buildStringStats(nonNullCells: readonly ProfileCellInput[]) {
  if (nonNullCells.length === 0) {
    return { minLength: 0, maxLength: 0, totalLength: 0, meanLength: null, emptyStringCount: 0 };
  }
  let minLength = Number.POSITIVE_INFINITY;
  let maxLength = 0;
  let totalLength = 0;
  let emptyStringCount = 0;
  for (const cell of nonNullCells) {
    const value = cell.normalizedValue as string;
    const len = codePointLength(value);
    if (len < minLength) minLength = len;
    if (len > maxLength) maxLength = len;
    totalLength += len;
    if (value === "") emptyStringCount += 1;
  }
  return {
    minLength,
    maxLength,
    totalLength,
    meanLength: exactCountRatioString(totalLength, nonNullCells.length),
    emptyStringCount,
  };
}

function buildBooleanStats(nonNullCells: readonly ProfileCellInput[], nullCount: number) {
  let trueCount = 0;
  let falseCount = 0;
  for (const cell of nonNullCells) {
    if (cell.normalizedValue === true) trueCount += 1;
    else falseCount += 1;
  }
  return { trueCount, falseCount, nullCount };
}

function buildNumericStats(nonNullCells: readonly ProfileCellInput[]) {
  if (nonNullCells.length === 0) {
    return { min: null, max: null, sum: null, mean: null };
  }
  const result = aggregateExactDecimalStrings(nonNullCells.map((c) => c.normalizedValue as string));
  // Caller has already validated every cell's shape, so this always
  // succeeds — defensive fallback only, never reached in practice.
  if (!result.ok) return { min: null, max: null, sum: null, mean: null };
  return {
    min: decimalToCanonicalString(result.min),
    max: decimalToCanonicalString(result.max),
    sum: decimalToCanonicalString(result.sum),
    mean: exactDecimalMeanString(result.sum, nonNullCells.length),
  };
}

function buildTemporalStats(nonNullCells: readonly ProfileCellInput[]) {
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
