// Data Hub 6.2D4C-B2A — pure row helper.
//
// Applies a validated NormalizationPlan to one raw row's worth of raw
// cells. Pure and side-effect-free: never writes a database, never
// generates a run/row/cell id, never mutates its inputs, never calls
// Prisma/SQL, never reads a workbook/file/network resource, and never logs
// a raw cell value. A blocking finding anywhere in the row means a future
// B2B executor cannot commit that row (or the run it belongs to) as
// successful — this module only computes that fact, it never enforces it.

import type { NormalizationFinding, NormalizationPlan, NormalizedValueOutput, RawCellInput } from "./contracts";
import { transformValue } from "./transformValue";

/** Minimal, non-sensitive row identity — no raw cell content. */
export interface RawRowIdentity {
  rawRowId: string;
  sourceRowNumber: number;
}

export interface RawCellForColumn {
  sourceSchemaColumnId: string;
  cell: RawCellInput;
}

export interface TransformRowResult {
  row: RawRowIdentity;
  /** One entry per successfully transformed governed column. */
  outputs: NormalizedValueOutput[];
  /** Any BLOCKING findings encountered for this row (each tagged with its own sourceSchemaColumnId). */
  findings: NormalizationFinding[];
}

/**
 * @param cells every raw cell for this row, one per governed column present on the row (a row missing a governed column simply has no entry for it — this helper never invents one)
 */
export function transformRow(row: RawRowIdentity, cells: readonly RawCellForColumn[], plan: NormalizationPlan): TransformRowResult {
  const outputs: NormalizedValueOutput[] = [];
  const findings: NormalizationFinding[] = [];

  for (const { sourceSchemaColumnId, cell } of cells) {
    const rule = plan.rulesByColumnId.get(sourceSchemaColumnId);
    if (!rule) {
      findings.push({ severity: "BLOCKING_ERROR", code: "UNKNOWN_RULE_COLUMN", sourceSchemaColumnId });
      continue;
    }
    const result = transformValue(rule, cell);
    if (result.ok) {
      outputs.push(result.output);
    } else {
      findings.push(...result.findings);
    }
  }

  return { row, outputs, findings };
}
