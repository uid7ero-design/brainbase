import { randomUUID } from "node:crypto";
import sql from "../../db";
import { resolveStagingEligibility } from "./eligibility";
import { readWorksheetDataRows, type WorksheetDataRow } from "../workbookParser";
import { buildImportBatchKey, RawFileStoreError } from "../storage/rawFileStore";
import { createImportBatchStorage } from "../importBatch/compositionRoot";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import type { ActiveStagingRun } from "./dataHubRawStagingRun";

// Data Hub 6.2D4B — the batched materialize-and-insert loop.
//
// CORRECTION 1 (batch/lease safety): every batch commits via ONE call to
// the `datahub_stage_raw_batch` Postgres function (see
// scripts/create-datahub-raw-staging-runs.sql), which — inside a single
// statement's implicit transaction — (1) atomically verifies/renews the
// lease BEFORE any insert, throwing if it doesn't affect exactly 1 row,
// (2) bulk-inserts rows, (3) bulk-inserts cells, (4) re-verifies the SAME
// lease while recording progress, throwing if that doesn't affect exactly
// 1 row. A thrown exception inside that single statement rolls back
// EVERYTHING the function did, including the row/cell inserts — this
// module can never observe or report LEASE_LOST after evidence has
// actually committed.
//
// Target batch size is 5,000-10,000 CELLS per commit (point 7 — an initial
// benchmark range, not a permanent constant; see
// tests/postgres-proof/datahubStagingBenchmark.postgres-proof.test.ts for
// the disposable-DB timing this range was chosen against).

export const TARGET_CELLS_PER_BATCH = 8000;
const MAX_ROWS_PER_PARSER_CALL = 2000;

export type StageBatchesFailureCode = "LEASE_LOST" | "PARSER_REJECTED" | "STORAGE_NOT_FOUND" | "PROVIDER_FAILURE" | "STORAGE_INTEGRITY_MISMATCH" | "WORKBOOK_INTEGRITY_CHANGED";

export interface StageBatchesResult {
  ok: boolean;
  code?: StageBatchesFailureCode;
  exhausted: boolean;
  persistedRowCount: number;
  persistedCellCount: number;
}

function buildBatchPayload(rows: WorksheetDataRow[]): unknown[] {
  return rows.map((row) => ({
    id: randomUUID(),
    sourceRowNumber: row.sourceRowOneBased,
    cells: row.cells.map((cell) => ({
      id: randomUUID(),
      sourceSchemaColumnId: cell.id,
      columnOrdinal: cell.ordinal,
      sourceHeader: cell.sourceHeader,
      sensitivityClass: cell.sensitivityClass,
      rawValue: cell.value,
      rawValueType: cell.value === null ? "NULL" : typeof cell.value === "number" ? "NUMBER" : typeof cell.value === "boolean" ? "BOOLEAN" : "STRING",
      originalUnit: null,
    })),
  }));
}

/**
 * Runs as many batches as fit within `maxDurationMs` of wall-clock time,
 * starting from the true physical-row resume cursor (MAX(source_row_number)
 * for this run — never persisted_row_count; see the architecture
 * report's resume-cursor decision). Returns without completing the run —
 * completion is a separate, explicit step (completionGate.ts) once
 * `exhausted` is true.
 */
export async function stageBatches(
  run: ActiveStagingRun,
  governedColumns: import("../workbookParser").GovernedColumnAddress[],
  maxDurationMs: number
): Promise<StageBatchesResult> {
  const eligibility = await resolveStagingEligibility({ organisationId: run.organisationId, uploadId: run.uploadId });
  if (!eligibility.ok) return { ok: false, code: "PARSER_REJECTED", exhausted: false, persistedRowCount: run.persistedRowCount, persistedCellCount: run.persistedCellCount };

  const storage = createImportBatchStorage();
  let stored;
  try {
    stored = await storage.get(buildImportBatchKey(run.organisationId, run.importBatchId), { maxBytes: MAX_SOURCE_FILE_BYTES });
  } catch (err) {
    if (err instanceof RawFileStoreError && err.code === "NOT_FOUND") {
      return { ok: false, code: "STORAGE_NOT_FOUND", exhausted: false, persistedRowCount: run.persistedRowCount, persistedCellCount: run.persistedCellCount };
    }
    return { ok: false, code: "PROVIDER_FAILURE", exhausted: false, persistedRowCount: run.persistedRowCount, persistedCellCount: run.persistedCellCount };
  }
  const { createHash } = await import("node:crypto");
  if (createHash("sha256").update(stored.body).digest("hex") !== eligibility.sha256) {
    return { ok: false, code: "STORAGE_INTEGRITY_MISMATCH", exhausted: false, persistedRowCount: run.persistedRowCount, persistedCellCount: run.persistedCellCount };
  }

  // Resume cursor: MAX(source_row_number) for THIS run, derived live from
  // the durable rows table — never persisted_row_count (which is a
  // progress/reconciliation counter only, not a physical-row pointer; see
  // the architecture report's resume-cursor correction).
  const cursorRows = (await sql`
    SELECT max(source_row_number) AS m FROM data_hub_raw_rows
    WHERE staging_run_id = ${run.id} AND organisation_id = ${run.organisationId}
  `) as unknown as { m: number | null }[];
  let resumeCursor: number | undefined = cursorRows[0]?.m ?? undefined;

  let persistedRowCount = run.persistedRowCount;
  let persistedCellCount = run.persistedCellCount;
  const startedAt = Date.now();
  let exhausted = false;

  for (;;) {
    if (Date.now() - startedAt > maxDurationMs) break;

    const rowsPerCall = Math.max(1, Math.min(MAX_ROWS_PER_PARSER_CALL, Math.floor(TARGET_CELLS_PER_BATCH / governedColumns.length) || 1));
    let page;
    try {
      page = await readWorksheetDataRows(
        stored.body,
        { filename: eligibility.originalFilename },
        {
          index: run.worksheetIndex,
          headerRowOneBased: run.headerRowOneBased,
          governedColumns,
          resumeAfterSourceRowOneBased: resumeCursor,
          maxRowsToRead: rowsPerCall,
        }
      );
    } catch {
      return { ok: false, code: "PARSER_REJECTED", exhausted: false, persistedRowCount, persistedCellCount };
    }

    if (page.rows.length === 0) {
      exhausted = page.exhausted;
      break;
    }

    const payload = buildBatchPayload(page.rows);
    let result;
    try {
      result = (await sql`
        SELECT * FROM datahub_stage_raw_batch(${run.id}, ${run.organisationId}, ${run.executionToken}, ${JSON.stringify(payload)}::jsonb)
      `) as unknown as { inserted_row_count: number; inserted_cell_count: number }[];
    } catch {
      // The function's own RAISE guarantees no partial evidence was
      // committed — correction 1: never report LEASE_LOST after allowing
      // inserts to commit. This IS that guarantee's caller-facing surface.
      return { ok: false, code: "LEASE_LOST", exhausted: false, persistedRowCount, persistedCellCount };
    }

    persistedRowCount += result[0].inserted_row_count;
    persistedCellCount += result[0].inserted_cell_count;
    resumeCursor = page.rows[page.rows.length - 1].sourceRowOneBased;

    if (page.exhausted) {
      exhausted = true;
      break;
    }
  }

  return { ok: true, exhausted, persistedRowCount, persistedCellCount };
}
