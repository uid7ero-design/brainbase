// Data Hub 6.2D4D1A — pure dataset profiling engine contracts.
//
// This module (and every sibling module under lib/data-hub/profiling/) is a
// PURE, deterministic library: no Prisma, no lib/db, no filesystem/network
// I/O, no workbook/XLSX parsing, no AI/model calls, no Date.now()/
// Math.random()/random UUID, no process.env. Given the same
// DatasetProfileInput, profileDataset() always produces a byte-equivalent
// DatasetProfile. See tests/containment/dataHubDatasetProfiler.test.ts's
// "pure boundary" suite for the enforced containment proof.
//
// D4D1A consumes ALREADY-NORMALIZED evidence only (D4C-B2A's own output
// shape) — it never reopens the workbook, never reads raw staging values,
// never resolves a live mapping/profile pointer, and never writes anything.
// It makes NO semantic claims about the data (no "this is a vehicle
// registration" style inference) — only domain-agnostic structural
// statistics. Semantic inference is explicitly out of scope for this slice
// (deferred to a future D4D2).

import type { ValueKind, Unit } from "../schemaProfiles/profileDocument";

export type { ValueKind, Unit };

// Identifies the exact semantics of THIS profiling engine implementation —
// deliberately NOT derived from package.json or the current date, and must
// only ever change when a maintainer deliberately revises v1's behavior.
export const DATASET_PROFILER_VERSION = "v1" as const;

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

/**
 * Mirrors the exact NormalizedValue encoding D4C-B2A/B2B1 already use:
 * STRING/IDENTIFIER/DATE/TIME/DATETIME -> JSON string; BOOLEAN -> JSON
 * boolean; INTEGER/DECIMAL/DURATION/PERCENTAGE/CURRENCY/LATITUDE/LONGITUDE
 * -> a canonical exact-decimal JSON string (never a JS number); NULL ->
 * JSON null. No second/looser interpretation is introduced here.
 */
export type NormalizedScalar = string | boolean | null;

export interface ProfileCellInput {
  sourceRowNumber: number;
  normalizedValue: NormalizedScalar;
}

export interface ProfileColumnInput {
  sourceSchemaColumnId: string;
  valueKind: ValueKind;
  sourceUnit: Unit | null;
  normalizedUnit: Unit | null;
  /**
   * One entry per row that has a value for this column. A row with no
   * entry here is treated identically to a row with normalizedValue: null
   * — both are "no value present" for null/non-null counting and
   * completeness purposes. cells.length must never exceed rowCount.
   */
  cells: ProfileCellInput[];
}

export interface DatasetProfileInput {
  rowCount: number;
  /** Governed column order — preserved verbatim in the output, never sorted. */
  columns: ProfileColumnInput[];
}

// ---------------------------------------------------------------------------
// Failure contract
// ---------------------------------------------------------------------------

// Single closed, non-value-bearing error code. Malformed input (wrong
// shape, duplicate ids/row numbers, out-of-range row numbers, a
// normalizedValue that doesn't match its column's valueKind encoding, an
// unsupported valueKind/unit, etc.) always collapses to exactly this —
// never the offending value, never a field name, never a stack/message
// derived from the input.
export const PROFILE_INPUT_ERROR_CODES = ["PROFILE_INPUT_INVALID"] as const;
export type ProfileInputErrorCode = (typeof PROFILE_INPUT_ERROR_CODES)[number];

export type ProfileDatasetResult = { ok: true; profile: DatasetProfile } | { ok: false; code: ProfileInputErrorCode };

// ---------------------------------------------------------------------------
// Output contract
// ---------------------------------------------------------------------------

export interface StringColumnStats {
  /** Lengths are counted in Unicode CODE POINTS (via Array.from), never UTF-16 code units — a surrogate-pair emoji counts as length 1, not 2. */
  minLength: number;
  maxLength: number;
  totalLength: number;
  /** totalLength / nonNullCount as a canonical decimal string, truncated (never rounded, never a JS float division) — null when nonNullCount is 0. */
  meanLength: string | null;
  emptyStringCount: number;
}

export interface BooleanColumnStats {
  trueCount: number;
  falseCount: number;
  nullCount: number;
}

export interface NumericColumnStats {
  /** Canonical exact-decimal strings — never derived via Number()/parseFloat. Null when nonNullCount is 0. */
  min: string | null;
  max: string | null;
  sum: string | null;
  /** Exact sum / nonNullCount as a canonical decimal string, truncated. Null when nonNullCount is 0. */
  mean: string | null;
}

export interface TemporalColumnStats {
  /** Canonical DATE/TIME/DATETIME strings, compared without any timezone/calendar reinterpretation. Null when nonNullCount is 0. */
  min: string | null;
  max: string | null;
}

export interface ColumnProfile {
  sourceSchemaColumnId: string;
  valueKind: ValueKind;
  sourceUnit: Unit | null;
  normalizedUnit: Unit | null;

  rowCount: number;
  nonNullCount: number;
  nullCount: number;
  distinctNonNullCount: number;

  /** Canonical decimal strings, truncated to a fixed precision (see ratio.ts). Null when the denominator (rowCount, or nonNullCount for distinctRatio) is 0. */
  nullRatio: string | null;
  nonNullRatio: string | null;
  distinctRatio: string | null;

  // Structural flags. Precise, threshold-free definitions (see
  // profileColumn.ts for the implementation):
  //   isAllNull            = rowCount > 0 && nonNullCount === 0
  //   isComplete           = nullCount === 0 (vacuously true at rowCount 0)
  //   isSparse             = rowCount > 0 && nonNullCount > 0 && nonNullCount < rowCount
  //   isConstant           = distinctNonNullCount === 1
  //   isUniqueAmongNonNull = nonNullCount > 0 && distinctNonNullCount === nonNullCount
  // isAllNull/isSparse/isComplete-with-nonNullCount>0 are mutually
  // exclusive over rowCount > 0. isUniqueAmongNonNull is a neutral
  // structural signal only — this layer never calls a column an
  // "identifier" merely because it is unique; semantic interpretation is
  // out of scope for D4D1A.
  isConstant: boolean;
  isAllNull: boolean;
  isUniqueAmongNonNull: boolean;
  isComplete: boolean;
  isSparse: boolean;

  // Exactly one of these is populated, matching valueKind:
  //   STRING, IDENTIFIER                                         -> stringStats
  //   BOOLEAN                                                    -> booleanStats
  //   INTEGER, DECIMAL, DURATION, PERCENTAGE, CURRENCY,
  //   LATITUDE, LONGITUDE                                        -> numericStats
  //   DATE, TIME, DATETIME                                       -> temporalStats
  stringStats?: StringColumnStats;
  booleanStats?: BooleanColumnStats;
  numericStats?: NumericColumnStats;
  temporalStats?: TemporalColumnStats;
}

export interface DatasetProfile {
  profilerVersion: typeof DATASET_PROFILER_VERSION;
  rowCount: number;
  columnCount: number;
  totalCellCount: number;
  nonNullCellCount: number;
  nullCellCount: number;
  completeRowCount: number;
  incompleteRowCount: number;
  /** Governed input column order, preserved verbatim — never sorted. */
  columns: ColumnProfile[];
}
