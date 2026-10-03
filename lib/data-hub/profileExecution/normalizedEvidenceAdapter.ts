// Data Hub 6.2D4D1B2 — adapter from persisted normalized evidence (D4C-B2A/
// B2B1's own durable shape) to D4D1A's pure DatasetProfileInput contract.
//
// This module reads the database but changes NOTHING in D4D1A's semantics —
// it only reconstructs the exact same shape D4D1A's own test fixtures
// build by hand. It never reopens the workbook, never reads raw staging,
// never resolves a "current"/live mapping pointer: every value read here
// (profile_document, governed columns, normalized rows/cells) is scoped to
// the EXACT pinned normalization_run_id/worksheet_mapping_profile_version_id
// the caller supplies — never WorksheetMappingProfile.active_profile_version_id.

import { prisma } from "../../prisma";
import { buildNormalizationPlan } from "../normalization/plan";
import type { DatasetProfileInput, NormalizedScalar, ProfileCellInput, ProfileColumnInput } from "../profiling/contracts";

export type ReconstructEvidenceFailureCode = "PROFILE_INPUT_INVALID";

export type ReconstructEvidenceResult =
  | { ok: true; input: DatasetProfileInput; sourceColumnOrdinalByColumnId: ReadonlyMap<string, number> }
  | { ok: false; code: ReconstructEvidenceFailureCode };

/**
 * Narrows a Prisma JSON value to D4D1A's NormalizedScalar. A normalized
 * cell's own value can only ever be a string, boolean, or null (never a
 * JS number, array, or object) by construction of
 * lib/data-hub/normalizationExecution/normalizeWorksheetRows.ts's own
 * write path — this is a shape ASSERTION over already-trusted persisted
 * evidence, not a second interpretation of it.
 */
function asNormalizedScalar(value: unknown): NormalizedScalar | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  return undefined;
}

/**
 * Reconstructs exactly one worksheet's governed column set + normalized
 * row/cell evidence for ONE pinned normalization run, in D4D1A's own input
 * shape. Column order is the governed SourceSchemaColumn.ordinal (never
 * alphabetical); row order inside each column's cells array follows the
 * same query order (ascending source_row_number), though D4D1A itself
 * treats cells as a set keyed by sourceRowNumber, not a sequence.
 *
 * rowCount is taken from the pinned DataHubNormalizationRun's own already-
 * reconciled persisted_row_count (normalization's own completion function
 * already proved this equals the actual persisted row count) — never a
 * fresh COUNT(*) re-derivation of an invariant the DB has already proven.
 */
export async function reconstructNormalizedDatasetEvidence(context: {
  organisationId: string;
  normalizationRunId: string;
  sourceSchemaWorksheetId: string;
  worksheetMappingProfileVersionId: string;
  rowCount: number;
}): Promise<ReconstructEvidenceResult> {
  const { organisationId, normalizationRunId, sourceSchemaWorksheetId, worksheetMappingProfileVersionId, rowCount } = context;

  const governedColumns = await prisma.sourceSchemaColumn.findMany({
    where: { organisation_id: organisationId, source_schema_worksheet_id: sourceSchemaWorksheetId },
    select: { id: true, ordinal: true },
    orderBy: { ordinal: "asc" },
  });
  if (governedColumns.length === 0) return { ok: false, code: "PROFILE_INPUT_INVALID" };

  const profileVersion = await prisma.worksheetMappingProfileVersion.findFirst({
    where: { id: worksheetMappingProfileVersionId, organisation_id: organisationId },
    select: { profile_document: true },
  });
  if (!profileVersion) return { ok: false, code: "PROFILE_INPUT_INVALID" };

  const planResult = buildNormalizationPlan(
    profileVersion.profile_document,
    governedColumns.map((c) => c.id)
  );
  if (!planResult.ok) return { ok: false, code: "PROFILE_INPUT_INVALID" };

  const cells = await prisma.dataHubNormalizedCell.findMany({
    where: {
      organisation_id: organisationId,
      normalized_row: { normalization_run_id: normalizationRunId },
    },
    select: {
      source_schema_column_id: true,
      normalized_value: true,
      normalized_row: { select: { source_row_number: true } },
    },
    orderBy: { normalized_row: { source_row_number: "asc" } },
  });

  const cellsByColumnId = new Map<string, ProfileCellInput[]>();
  for (const cell of cells) {
    const scalar = asNormalizedScalar(cell.normalized_value);
    if (scalar === undefined) return { ok: false, code: "PROFILE_INPUT_INVALID" };
    const list = cellsByColumnId.get(cell.source_schema_column_id);
    const entry: ProfileCellInput = { sourceRowNumber: cell.normalized_row.source_row_number, normalizedValue: scalar };
    if (list) list.push(entry);
    else cellsByColumnId.set(cell.source_schema_column_id, [entry]);
  }

  const columns: ProfileColumnInput[] = [];
  for (const column of governedColumns) {
    const rule = planResult.plan.rulesByColumnId.get(column.id);
    if (!rule) return { ok: false, code: "PROFILE_INPUT_INVALID" };
    columns.push({
      sourceSchemaColumnId: column.id,
      valueKind: rule.valueKind,
      sourceUnit: rule.sourceUnit ?? null,
      normalizedUnit: rule.normalizedUnit ?? null,
      cells: cellsByColumnId.get(column.id) ?? [],
    });
  }

  return {
    ok: true,
    input: { rowCount, columns },
    sourceColumnOrdinalByColumnId: new Map(governedColumns.map((c) => [c.id, c.ordinal])),
  };
}
