// Data Hub 6.2D4D1A — pure dataset-level profiling entry point.
//
// profileDataset() is the only exported entry a caller needs. It validates
// the WHOLE input (never a partial/best-effort profile for a malformed
// dataset), then profiles each governed column in its ORIGINAL input order
// (never sorted/reordered), then aggregates dataset-level structural
// facts. See contracts.ts for the full input/output shape and
// profileColumn.ts for the per-column rules.
//
// MEMORY/OVERFLOW SAFETY (final review remediation): this module never
// allocates anything sized by the DECLARED rowCount — only by the ACTUAL
// evidence supplied (cells arrays). rowCount may be an arbitrarily large
// safe integer without risking a RangeError or an O(declared row
// universe) allocation; every aggregate count (totalCellCount,
// nonNullCellCount, nullCellCount, completeRowCount, incompleteRowCount)
// is computed via lib/data-hub/profiling/safeInt.ts's BigInt-backed
// helpers and fails closed (PROFILE_INPUT_INVALID) rather than silently
// exceeding Number.MAX_SAFE_INTEGER.
//
// Deliberately deferred to a future D4D1B (not implemented here): duplicate
// -row detection. Building a safe, non-value-leaking composite row key
// across every governed column (with correct escaping so e.g. ("a","bc")
// never collides with ("ab","c")) is real complexity this first pure-
// correctness slice does not need — see the task's own explicit allowance
// to defer it rather than implement it poorly.

import type { ColumnProfile, DatasetProfile, DatasetProfileInput, ProfileDatasetResult } from "./contracts";
import { DATASET_PROFILER_VERSION } from "./contracts";
import { profileColumn, validateColumnInput } from "./profileColumn";
import { isSafeNonNegativeInteger, safeMultiply, safeSubtractNonNegative, safeSum } from "./safeInt";

const INVALID: ProfileDatasetResult = { ok: false, code: "PROFILE_INPUT_INVALID" };

function isValidDatasetShape(input: DatasetProfileInput): boolean {
  if (!isSafeNonNegativeInteger(input.rowCount)) return false;
  if (!Array.isArray(input.columns)) return false;
  const seenColumnIds = new Set<string>();
  for (const column of input.columns) {
    if (seenColumnIds.has(column.sourceSchemaColumnId)) return false;
    seenColumnIds.add(column.sourceSchemaColumnId);
    if (!validateColumnInput(column, input.rowCount).ok) return false;
  }
  return true;
}

export function profileDataset(input: DatasetProfileInput): ProfileDatasetResult {
  if (!isValidDatasetShape(input)) return INVALID;

  const rowCount = input.rowCount;
  const columnCount = input.columns.length;

  // Tracks, per source row number, how many columns have a non-null value
  // for it — built ONLY from observed non-null evidence (never sized by
  // the declared rowCount), so memory stays O(cells), not O(rowCount).
  const nonNullColumnCountByRow = new Map<number, number>();

  const columns: ColumnProfile[] = [];
  for (const column of input.columns) {
    const result = profileColumn(column, rowCount);
    if (!result.ok) return INVALID;
    columns.push(result.profile);
    for (const rowNumber of result.nonNullRowNumbers) {
      nonNullColumnCountByRow.set(rowNumber, (nonNullColumnCountByRow.get(rowNumber) ?? 0) + 1);
    }
  }

  let completeRowCount: number;
  if (columnCount === 0) {
    // Vacuously true: 0 of 0 required columns present for every row.
    completeRowCount = rowCount;
  } else {
    completeRowCount = 0;
    for (const count of nonNullColumnCountByRow.values()) {
      if (count === columnCount) completeRowCount += 1;
    }
  }
  const incompleteRowCountResult = safeSubtractNonNegative(rowCount, completeRowCount);
  if (!incompleteRowCountResult.ok) return INVALID;
  const incompleteRowCount = incompleteRowCountResult.value;

  const totalCellCountResult = safeMultiply(rowCount, columnCount);
  if (!totalCellCountResult.ok) return INVALID;
  const totalCellCount = totalCellCountResult.value;

  const nonNullCellCountResult = safeSum(columns.map((c) => c.nonNullCount));
  if (!nonNullCellCountResult.ok) return INVALID;
  const nonNullCellCount = nonNullCellCountResult.value;

  const nullCellCountResult = safeSubtractNonNegative(totalCellCount, nonNullCellCount);
  if (!nullCellCountResult.ok) return INVALID;
  const nullCellCount = nullCellCountResult.value;

  const profile: DatasetProfile = {
    profilerVersion: DATASET_PROFILER_VERSION,
    rowCount,
    columnCount,
    totalCellCount,
    nonNullCellCount,
    nullCellCount,
    completeRowCount,
    incompleteRowCount,
    columns,
  };

  return { ok: true, profile };
}
