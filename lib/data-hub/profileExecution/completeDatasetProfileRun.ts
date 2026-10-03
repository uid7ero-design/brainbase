import { randomUUID } from "node:crypto";
import sql from "../../db";
import type { DatasetProfile } from "../profiling/contracts";

// Data Hub 6.2D4D1B2 — Phase C: the single atomic completion transaction.
// Thin wrapper around the SQL function
// public.datahub_complete_dataset_profile_run(...)
// (scripts/create-datahub-profile-execution.sql), mirroring
// datahub_complete_normalization_run's own shape: one DB function call,
// one implicit transaction, inserting every immutable
// DataHubDatasetProfileColumn row, transitioning the run to SUCCEEDED
// (which fires D4D1B1's own pre-existing reconciliation trigger), and
// writing Upload's authoritative profile pointer -- ALL of it or NONE of
// it. If the function raises for any reason (the reconciliation trigger,
// or any other DB error), Postgres rolls back the entire statement,
// including every column insert already performed inside this same
// function call -- D4D1B1's column-evidence immutability guarantee is
// therefore never at risk of stranding a partial column set, because no
// column row is ever durably committed unless the WHOLE completion
// succeeds.

export type CompleteDatasetProfileRunFailureCode = "PROFILE_RECONCILIATION_FAILED" | "PERSISTENCE_FAILURE";

export type CompleteDatasetProfileRunResult = { ok: true; rowCount: number; columnCount: number } | { ok: false; code: CompleteDatasetProfileRunFailureCode };

interface ColumnRow {
  id: string;
  sourceSchemaColumnId: string;
  ordinal: number;
  sourceColumnOrdinal: number;
  valueKind: string;
  sourceUnit: string | null;
  normalizedUnit: string | null;
  rowCount: number;
  nonNullCount: number;
  nullCount: number;
  distinctNonNullCount: number;
  nullRatio: string | null;
  nonNullRatio: string | null;
  distinctRatio: string | null;
  isConstant: boolean;
  isAllNull: boolean;
  isUniqueAmongNonNull: boolean;
  isComplete: boolean;
  isSparse: boolean;
  minLength: number | null;
  maxLength: number | null;
  totalLength: number | null;
  meanLength: string | null;
  emptyStringCount: number | null;
  trueCount: number | null;
  falseCount: number | null;
  numericMin: string | null;
  numericMax: string | null;
  numericSum: string | null;
  numericMean: string | null;
  temporalMin: string | null;
  temporalMax: string | null;
}

/**
 * Converts D4D1A's own ColumnProfile[] (governed array order, index ==
 * D4D1A's own contiguous output ordinal) into the exact JSONB row shape
 * datahub_complete_dataset_profile_run expects. Each column row's own id
 * is minted here (same precedent as normalizeWorksheetRows.ts minting
 * row/cell ids before handing them to datahub_stage_normalized_batch) --
 * the SQL function never generates its own ids.
 */
function buildColumnRows(profile: DatasetProfile, sourceColumnOrdinalByColumnId: ReadonlyMap<string, number>): ColumnRow[] {
  return profile.columns.map((column, index) => ({
    id: randomUUID(),
    sourceSchemaColumnId: column.sourceSchemaColumnId,
    ordinal: index,
    sourceColumnOrdinal: sourceColumnOrdinalByColumnId.get(column.sourceSchemaColumnId) ?? 0,
    valueKind: column.valueKind,
    sourceUnit: column.sourceUnit,
    normalizedUnit: column.normalizedUnit,
    rowCount: column.rowCount,
    nonNullCount: column.nonNullCount,
    nullCount: column.nullCount,
    distinctNonNullCount: column.distinctNonNullCount,
    nullRatio: column.nullRatio,
    nonNullRatio: column.nonNullRatio,
    distinctRatio: column.distinctRatio,
    isConstant: column.isConstant,
    isAllNull: column.isAllNull,
    isUniqueAmongNonNull: column.isUniqueAmongNonNull,
    isComplete: column.isComplete,
    isSparse: column.isSparse,
    minLength: column.stringStats?.minLength ?? null,
    maxLength: column.stringStats?.maxLength ?? null,
    totalLength: column.stringStats?.totalLength ?? null,
    meanLength: column.stringStats?.meanLength ?? null,
    emptyStringCount: column.stringStats?.emptyStringCount ?? null,
    trueCount: column.booleanStats?.trueCount ?? null,
    falseCount: column.booleanStats?.falseCount ?? null,
    numericMin: column.numericStats?.min ?? null,
    numericMax: column.numericStats?.max ?? null,
    numericSum: column.numericStats?.sum ?? null,
    numericMean: column.numericStats?.mean ?? null,
    temporalMin: column.temporalStats?.min ?? null,
    temporalMax: column.temporalStats?.max ?? null,
  }));
}

// D4D1B1's own exact RAISE EXCEPTION text for every reconciliation branch
// in datahub_guard_dataset_profile_run_lifecycle() -- used ONLY to pick a
// bounded failure_code in-memory, never persisted, never logged, never
// returned to any caller.
const RECONCILIATION_MESSAGE_FRAGMENTS = [
  "reconciliation failed",
];

function classifyCompletionError(err: unknown): CompleteDatasetProfileRunFailureCode {
  const message = err instanceof Error ? err.message : "";
  if (RECONCILIATION_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment))) {
    return "PROFILE_RECONCILIATION_FAILED";
  }
  return "PERSISTENCE_FAILURE";
}

export async function completeDatasetProfileRun(context: {
  organisationId: string;
  profileRunId: string;
  completedBy: string;
  profile: DatasetProfile;
  sourceColumnOrdinalByColumnId: ReadonlyMap<string, number>;
}): Promise<CompleteDatasetProfileRunResult> {
  const columns = buildColumnRows(context.profile, context.sourceColumnOrdinalByColumnId);

  try {
    const rows = (await sql`
      SELECT * FROM datahub_complete_dataset_profile_run(
        ${context.profileRunId},
        ${context.organisationId},
        ${context.completedBy},
        ${JSON.stringify(columns)}::jsonb,
        ${context.profile.rowCount},
        ${context.profile.columnCount},
        ${context.profile.totalCellCount},
        ${context.profile.nonNullCellCount},
        ${context.profile.nullCellCount},
        ${context.profile.completeRowCount},
        ${context.profile.incompleteRowCount}
      )
    `) as unknown as { row_count: string; column_count: string }[];
    const row = rows[0];
    if (!row) return { ok: false, code: "PERSISTENCE_FAILURE" };
    return { ok: true, rowCount: Number(row.row_count), columnCount: Number(row.column_count) };
  } catch (err) {
    return { ok: false, code: classifyCompletionError(err) };
  }
}
