import { createHash } from "node:crypto";
import { prisma } from "../../prisma";
import { classifyFormat } from "../fileSignatures";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import { buildImportBatchKey, RawFileStoreError } from "../storage/rawFileStore";
import { readWorksheetHeaderRows, WorkbookParserError } from "../workbookParser";
import { createImportBatchStorage } from "../importBatch/compositionRoot";
import { getMessageTemplate, type FailureCode } from "../importBatch/failureTaxonomy";
import { loadGovernedSchemaForSourceSystem } from "./governedSchema";
import {
  matchObservedWorkbookStructure,
  planHeaderRowReads,
  type ObservedWorksheetInput,
  type SchemaMatchReport,
} from "./schemaMatcher";

// Data Hub 6.2D3C — READ-ONLY governed schema comparison for one XLSX
// ImportBatch. Inputs are ONLY the trusted session organisationId and the
// path importBatchId; the governed schema is resolved server-side from the
// batch's own persisted source_system_id (see governedSchema.ts).
//
// Every fact is re-read on every call, before any storage access:
//   1. tenant-scoped, non-tombstoned batch; READY; sha256 present;
//      persisted content_type "xlsx" AND original_filename classifies xlsx
//   2. the batch has SourceSystem lineage
//   3. the persisted DATA_HUB worksheet descriptors (ALL of them — hidden
//      and empty sheets included in the observed inventory) form a
//      contiguous 0..n-1 index set
//   4. the governed schema resolves for this tenant + source system
// Then: server-derived storage key, bounded GET, SHA-256 re-verification,
// and readWorksheetHeaderRows for ONLY the visible, non-empty sheets that
// match a governed worksheet defining columns (planHeaderRowReads). The
// workbook's sheet names/visibility must equal the persisted descriptors
// exactly, else STORAGE_INTEGRITY_MISMATCH (fail closed).
//
// Only header-row text of governed sheets reaches the matcher; no data row
// is read, returned, logged or persisted. The report carries no filename,
// user, timestamp, sample value or raw error text.
//
// NO WRITES: findUnique/findFirst/findMany only; no $transaction; no audit
// write. ImportBatch dataset-type/schema-version lineage columns, schema
// status/activated_at, profile activation, SourceMapping/MappingVersion,
// Upload rows, staging/canonical/reconciliation data are never touched.
// XLSX mapping selection/confirmation stay blocked by their own
// UNSUPPORTED_FORMAT gates, which this module does not reference.

export type SchemaMatchFailureCode =
  | "BATCH_NOT_FOUND"
  | "BATCH_NOT_READY"
  | "UNSUPPORTED_FORMAT"
  | "SOURCE_LINEAGE_REQUIRED"
  | "INVALID_STATE"
  | "GOVERNED_SCHEMA_UNAVAILABLE"
  | "STORAGE_NOT_FOUND"
  | "PROVIDER_FAILURE"
  | "STORAGE_INTEGRITY_MISMATCH"
  | "PARSER_REJECTED";

export type SchemaMatchServiceResult =
  | { ok: true; report: SchemaMatchReport }
  | { ok: false; code: SchemaMatchFailureCode; message: string };

// D3C-local, caller-only (never persisted). Kept out of the shared
// FailureCode union so the confirm/mapping/period routes' exhaustive status
// maps stay untouched. One generic message for every reason (missing,
// inactive, retired, unexpected identity, cross-tenant) — never says which.
const GOVERNED_SCHEMA_UNAVAILABLE_MESSAGE =
  "No governed source schema is available to compare this workbook against. No changes were made.";

function fail(code: SchemaMatchFailureCode): SchemaMatchServiceResult {
  const message = code === "GOVERNED_SCHEMA_UNAVAILABLE" ? GOVERNED_SCHEMA_UNAVAILABLE_MESSAGE : getMessageTemplate(code as FailureCode);
  return { ok: false, code, message };
}

function filenameClassifiesAsXlsx(filename: string): boolean {
  try {
    return classifyFormat({ filename }) === "xlsx";
  } catch {
    return false;
  }
}

function isVisibility(value: string | null): value is ObservedWorksheetInput["visibility"] {
  return value === "visible" || value === "hidden" || value === "veryHidden";
}

export async function matchImportBatchSchema(context: {
  organisationId: string;
  importBatchId: string;
}): Promise<SchemaMatchServiceResult> {
  const { organisationId, importBatchId } = context;

  const batch = await prisma.importBatch.findUnique({
    where: { id_organisation_id: { id: importBatchId, organisation_id: organisationId } },
    select: { status: true, deleted_at: true, sha256: true, content_type: true, original_filename: true, source_system_id: true },
  });
  if (!batch || batch.deleted_at !== null) return fail("BATCH_NOT_FOUND");
  if (batch.status !== "READY") return fail("BATCH_NOT_READY");
  if (batch.content_type !== "xlsx" || !filenameClassifiesAsXlsx(batch.original_filename)) return fail("UNSUPPORTED_FORMAT");
  if (!batch.sha256) return fail("PROVIDER_FAILURE");
  if (!batch.source_system_id) return fail("SOURCE_LINEAGE_REQUIRED");

  const rows = await prisma.upload.findMany({
    where: { organisation_id: organisationId, import_batch_id: importBatchId, lineage_kind: "DATA_HUB" },
    orderBy: { worksheet_index: "asc" },
    select: { worksheet_index: true, worksheet_name: true, worksheet_visibility: true, worksheet_is_empty: true },
  });
  if (rows.length === 0) return fail("INVALID_STATE");
  const descriptors: Omit<ObservedWorksheetInput, "headerRow">[] = [];
  for (const [position, row] of rows.entries()) {
    if (
      row.worksheet_index !== position ||
      row.worksheet_name === null ||
      !isVisibility(row.worksheet_visibility) ||
      typeof row.worksheet_is_empty !== "boolean"
    ) {
      return fail("INVALID_STATE");
    }
    descriptors.push({
      index: row.worksheet_index,
      name: row.worksheet_name,
      visibility: row.worksheet_visibility,
      isEmpty: row.worksheet_is_empty,
    });
  }

  const governed = await loadGovernedSchemaForSourceSystem({ organisationId, sourceSystemId: batch.source_system_id });
  if (!governed.ok) return fail("GOVERNED_SCHEMA_UNAVAILABLE");
  const plan = planHeaderRowReads(descriptors, governed.schema);

  const storage = createImportBatchStorage();
  let stored;
  try {
    stored = await storage.get(buildImportBatchKey(organisationId, importBatchId), { maxBytes: MAX_SOURCE_FILE_BYTES });
  } catch (err) {
    if (err instanceof RawFileStoreError && err.code === "NOT_FOUND") return fail("STORAGE_NOT_FOUND");
    return fail("PROVIDER_FAILURE");
  }
  if (createHash("sha256").update(stored.body).digest("hex") !== batch.sha256) {
    return fail("STORAGE_INTEGRITY_MISMATCH");
  }

  let headerRows;
  try {
    headerRows = await readWorksheetHeaderRows(stored.body, { filename: batch.original_filename }, plan);
  } catch (err) {
    if (err instanceof WorkbookParserError) return fail("PARSER_REJECTED");
    throw err;
  }

  // Persisted descriptors must still describe these hash-pinned bytes.
  if (
    headerRows.sheetNames.length !== descriptors.length ||
    descriptors.some((d) => headerRows.sheetNames[d.index] !== d.name || headerRows.visibilities[d.index] !== d.visibility) ||
    headerRows.worksheets.some((w, k) => w.index !== plan[k].index || w.name !== descriptors[w.index].name || w.visibility !== "visible")
  ) {
    return fail("STORAGE_INTEGRITY_MISMATCH");
  }

  const outcomeByIndex = new Map(headerRows.worksheets.map((w) => [w.index, w.outcome]));
  const observed: ObservedWorksheetInput[] = descriptors.map((d) => ({
    ...d,
    headerRow: outcomeByIndex.get(d.index) ?? { status: "notRead" },
  }));

  return { ok: true, report: matchObservedWorkbookStructure({ observed: { worksheets: observed }, governedSchema: governed.schema }) };
}
