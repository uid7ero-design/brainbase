import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma";
import sql from "../../db";
import { transformRow, type RawCellForColumn } from "./transformRow";
import type { ActiveNormalizationRun } from "./dataHubNormalizationRun";
import { markNormalizationRunFailed, releaseNormalizationLeaseForYield } from "./dataHubNormalizationRun";
import { resolveLeaseSeconds, resolveTargetCellsPerBatch } from "../staging/stagingConfig";

// Data Hub 6.2D4B2A -- the batched transform-and-persist loop. Exact
// structural analogue of lib/data-hub/staging/stageWorksheetRows.ts,
// applied to normalization instead of raw staging:
//   derive resume cursor -> load bounded raw-row batch (from persisted D4A/
//   D4B evidence, never the workbook) -> transform via the merged B2A
//   modules -> persist via ONE call to datahub_stage_normalized_batch(...)
//   -> continue, yield, fail (blocking), or exhaust.
//
// RESUME CURSOR: MAX(source_row_number) from data_hub_normalized_rows for
// this exact normalization_run_id + organisation_id -- never
// persisted_row_count (a progress counter, not a physical-row pointer;
// exact same correction D4B already applies to its own raw-row cursor). A
// FAILED prior attempt's own normalized rows never affect this, because
// they are scoped to THAT attempt's own normalization_run_id, never this
// one's.
//
// RAW INPUT: loaded directly from data_hub_raw_rows/data_hub_raw_cells,
// scoped to the run's own pinned raw_staging_run_id AND pinned worksheet/
// version lineage -- never the Upload preview JSON, never the source
// workbook, never inferred from headers.
//
// BLOCKING ROW BEHAVIOUR (point 9): the moment transformRow returns any
// BLOCKING_ERROR finding for a row, that row is EXCLUDED from the
// normalized payload; its findings are added to the finding payload for
// THIS SAME atomic call (successful rows gathered earlier in this batch
// persist together with it -- B2B1's own same-call overlap guard already
// makes that safe). No row physically AFTER the blocking row is
// transformed or persisted, even if it was already fetched as part of the
// same page. After that one atomic persistence succeeds, the run
// transitions to FAILED under the SAME live lease and this function
// returns without processing any further batches.

const MAX_ROWS_PER_DB_CALL = 2000;

export type NormalizeBatchesFailureCode = "LEASE_LOST" | "PERSISTENCE_FAILURE" | "NORMALIZATION_BLOCKED";

export interface NormalizeBatchesResult {
  ok: boolean;
  code?: NormalizeBatchesFailureCode;
  exhausted: boolean;
  persistedRowCount: number;
  persistedCellCount: number;
}

interface RawRowForBatch {
  id: string;
  sourceRowNumber: number;
  cells: { id: string; sourceSchemaColumnId: string; rawValue: unknown; rawValueType: "STRING" | "NUMBER" | "BOOLEAN" | "NULL" }[];
}

async function loadRawRowBatch(run: ActiveNormalizationRun, afterSourceRowNumber: number | undefined, limit: number): Promise<RawRowForBatch[]> {
  const rows = await prisma.dataHubRawRow.findMany({
    where: {
      organisation_id: run.organisationId,
      staging_run_id: run.rawStagingRunId,
      source_schema_worksheet_id: run.sourceSchemaWorksheetId,
      source_schema_version_id: run.sourceSchemaVersionId,
      ...(afterSourceRowNumber === undefined ? {} : { source_row_number: { gt: afterSourceRowNumber } }),
    },
    orderBy: { source_row_number: "asc" },
    take: limit,
    select: {
      id: true,
      source_row_number: true,
      cells: {
        select: { id: true, source_schema_column_id: true, raw_value: true, raw_value_type: true },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    sourceRowNumber: r.source_row_number,
    cells: r.cells.map((c) => ({
      id: c.id,
      sourceSchemaColumnId: c.source_schema_column_id,
      rawValue: c.raw_value,
      rawValueType: c.raw_value_type as "STRING" | "NUMBER" | "BOOLEAN" | "NULL",
    })),
  }));
}

function classifyPersistenceError(err: unknown): "LEASE_LOST" | "PERSISTENCE_FAILURE" {
  const message = err instanceof Error ? err.message : String(err);
  if (/lease not held before insert|lease lost before progress commit/.test(message)) {
    return "LEASE_LOST";
  }
  return "PERSISTENCE_FAILURE";
}

/**
 * Runs as many batches as fit within `maxDurationMs` of wall-clock time,
 * starting from the true resume cursor. Returns without completing the run
 * -- completion is a separate, explicit step (completeNormalizationRun.ts)
 * once `exhausted` is true. If a blocking row is encountered, the run is
 * transitioned to FAILED before this function returns and `ok` is false
 * with code NORMALIZATION_BLOCKED.
 */
export async function normalizeBatches(run: ActiveNormalizationRun, maxDurationMs: number): Promise<NormalizeBatchesResult> {
  const cursorRows = (await sql`
    SELECT max(source_row_number) AS m FROM data_hub_normalized_rows
    WHERE normalization_run_id = ${run.id} AND organisation_id = ${run.organisationId}
  `) as unknown as { m: number | null }[];
  let resumeCursor: number | undefined = cursorRows[0]?.m ?? undefined;

  let persistedRowCount = run.persistedRowCount;
  let persistedCellCount = run.persistedCellCount;
  const startedAt = Date.now();
  const leaseSeconds = resolveLeaseSeconds();
  const targetCellsPerBatch = resolveTargetCellsPerBatch();
  let exhausted = false;

  // Column count for batch sizing purposes: the number of governed rules in
  // the plan (one raw cell per governed column per row, at most).
  const columnCount = Math.max(1, run.plan.rulesByColumnId.size);

  // Remediation parity with D4B: a "process a batch, THEN check the time
  // budget" loop -- always attempts at least ONE batch when work remains,
  // regardless of how small maxDurationMs is.
  for (;;) {
    const rowsPerCall = Math.max(1, Math.min(MAX_ROWS_PER_DB_CALL, Math.floor(targetCellsPerBatch / columnCount) || 1));
    const rawRows = await loadRawRowBatch(run, resumeCursor, rowsPerCall);

    if (rawRows.length === 0) {
      exhausted = true;
      break;
    }

    const normalizedPayload: unknown[] = [];
    const findingPayload: unknown[] = [];
    let blockingEncountered = false;
    let lastProcessedSourceRowNumber = resumeCursor;
    const pageExhausted = rawRows.length < rowsPerCall;

    for (const rawRow of rawRows) {
      const cellIdByColumnId = new Map<string, string>();
      const cellsForColumn: RawCellForColumn[] = rawRow.cells.map((c) => {
        cellIdByColumnId.set(c.sourceSchemaColumnId, c.id);
        return {
          sourceSchemaColumnId: c.sourceSchemaColumnId,
          cell: { rawValueType: c.rawValueType, rawValue: c.rawValue as string | number | boolean | null },
        };
      });

      const result = transformRow({ rawRowId: rawRow.id, sourceRowNumber: rawRow.sourceRowNumber }, cellsForColumn, run.plan);

      const hasBlocking = result.findings.some((f) => f.severity === "BLOCKING_ERROR");
      if (hasBlocking) {
        for (const finding of result.findings) {
          const rawCellId = finding.sourceSchemaColumnId ? (cellIdByColumnId.get(finding.sourceSchemaColumnId) ?? null) : null;
          const sourceSchemaColumnId = rawCellId ? finding.sourceSchemaColumnId : null;
          findingPayload.push({
            id: randomUUID(),
            rawRowId: rawRow.id,
            sourceRowNumber: rawRow.sourceRowNumber,
            rawCellId: rawCellId,
            sourceSchemaColumnId: sourceSchemaColumnId,
            severity: finding.severity,
            findingCode: finding.code,
            valueKind: finding.valueKind ?? null,
          });
        }
        blockingEncountered = true;
        break;
      }

      normalizedPayload.push({
        id: randomUUID(),
        rawRowId: rawRow.id,
        sourceRowNumber: rawRow.sourceRowNumber,
        cells: result.outputs.map((o) => ({
          id: randomUUID(),
          rawCellId: cellIdByColumnId.get(o.sourceSchemaColumnId) ?? null,
          sourceSchemaColumnId: o.sourceSchemaColumnId,
          valueKind: o.valueKind,
          normalizedValue: o.normalizedValue,
          sourceUnit: o.sourceUnit,
          normalizedUnit: o.normalizedUnit,
        })),
      });
      // WARNING findings (none in the current library, but handled
      // generically for forward-compatibility) coexist with the normalized
      // row -- B2B1 permits this both same-call and cross-call.
      for (const finding of result.findings) {
        const rawCellId = finding.sourceSchemaColumnId ? (cellIdByColumnId.get(finding.sourceSchemaColumnId) ?? null) : null;
        const sourceSchemaColumnId = rawCellId ? finding.sourceSchemaColumnId : null;
        findingPayload.push({
          id: randomUUID(),
          rawRowId: rawRow.id,
          sourceRowNumber: rawRow.sourceRowNumber,
          rawCellId,
          sourceSchemaColumnId,
          severity: finding.severity,
          findingCode: finding.code,
          valueKind: finding.valueKind ?? null,
        });
      }
      lastProcessedSourceRowNumber = rawRow.sourceRowNumber;
    }

    if (normalizedPayload.length > 0 || findingPayload.length > 0) {
      let result;
      try {
        result = (await sql`
          SELECT * FROM datahub_stage_normalized_batch(${run.id}, ${run.organisationId}, ${run.executionToken}, ${JSON.stringify(normalizedPayload)}::jsonb, ${JSON.stringify(findingPayload)}::jsonb, ${leaseSeconds}::int)
        `) as unknown as { inserted_row_count: number; inserted_cell_count: number; inserted_finding_count: number }[];
      } catch (err) {
        return { ok: false, code: classifyPersistenceError(err), exhausted: false, persistedRowCount, persistedCellCount };
      }
      persistedRowCount += result[0].inserted_row_count;
      persistedCellCount += result[0].inserted_cell_count;
    }

    if (blockingEncountered) {
      // Point 9: once a blocking row is durably persisted, do not continue
      // to later source rows -- transition the run to FAILED under the
      // SAME live lease, using a stable, non-PII failure code/detail.
      const failed = await markNormalizationRunFailed({
        organisationId: run.organisationId,
        runId: run.id,
        executionToken: run.executionToken,
        failureCode: "NORMALIZATION_BLOCKED",
        failureDetail: "One or more blocking normalization findings were persisted.",
      });
      if (!failed) {
        return { ok: false, code: "LEASE_LOST", exhausted: false, persistedRowCount, persistedCellCount };
      }
      return { ok: false, code: "NORMALIZATION_BLOCKED", exhausted: false, persistedRowCount, persistedCellCount };
    }

    resumeCursor = lastProcessedSourceRowNumber;

    if (pageExhausted) {
      exhausted = true;
      break;
    }

    if (Date.now() - startedAt > maxDurationMs) {
      const released = await releaseNormalizationLeaseForYield({
        organisationId: run.organisationId,
        runId: run.id,
        executionToken: run.executionToken,
      });
      if (!released) {
        return { ok: false, code: "LEASE_LOST", exhausted: false, persistedRowCount, persistedCellCount };
      }
      return { ok: true, exhausted: false, persistedRowCount, persistedCellCount };
    }
  }

  return { ok: true, exhausted, persistedRowCount, persistedCellCount };
}
