// Data Hub 6.2D4D1A — pure dataset-level profiling entry point.
//
// profileDataset() is the only exported entry a caller needs. It validates
// the WHOLE input (never a partial/best-effort profile for a malformed
// dataset), then profiles each governed column in its ORIGINAL input order
// (never sorted/reordered), then aggregates dataset-level structural
// facts. See contracts.ts for the full input/output shape and
// profileColumn.ts for the per-column rules.
//
// Deliberately deferred to a future D4D1B (not implemented here): duplicate
// -row detection. Building a safe, non-value-leaking composite row key
// across every governed column (with correct escaping so e.g. ("a","bc")
// never collides with ("ab","c")) is real complexity this first pure-
// correctness slice does not need — see the task's own explicit allowance
// to defer it rather than implement it poorly.

import type { DatasetProfile, DatasetProfileInput, ProfileDatasetResult } from "./contracts";
import { DATASET_PROFILER_VERSION } from "./contracts";
import { profileColumn, validateColumnInput } from "./profileColumn";

function isValidDatasetShape(input: DatasetProfileInput): boolean {
  if (!Number.isInteger(input.rowCount) || input.rowCount < 0) return false;
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
  if (!isValidDatasetShape(input)) return { ok: false, code: "PROFILE_INPUT_INVALID" };

  const rowCount = input.rowCount;
  const columnCount = input.columns.length;

  // Per-row count of how many columns have a non-null value for that row —
  // used only to derive completeRowCount/incompleteRowCount, never
  // serialized itself (it carries no cell values, only a tally).
  const nonNullColumnCountByRow = new Array<number>(rowCount).fill(0);

  const columns = input.columns.map((column) => {
    const { profile, nonNullRowNumbers } = profileColumn(column, rowCount);
    for (const rowNumber of nonNullRowNumbers) {
      nonNullColumnCountByRow[rowNumber - 1] += 1;
    }
    return profile;
  });

  let completeRowCount = 0;
  for (let i = 0; i < rowCount; i++) {
    if (nonNullColumnCountByRow[i] === columnCount) completeRowCount += 1;
  }
  const incompleteRowCount = rowCount - completeRowCount;

  const totalCellCount = rowCount * columnCount;
  const nonNullCellCount = columns.reduce((sum, c) => sum + c.nonNullCount, 0);
  const nullCellCount = totalCellCount - nonNullCellCount;

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
