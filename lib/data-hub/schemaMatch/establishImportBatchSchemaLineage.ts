import { createHash } from "node:crypto";
import { prisma } from "../../prisma";
import { classifyFormat } from "../fileSignatures";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import { buildImportBatchKey, RawFileStoreError } from "../storage/rawFileStore";
import { readWorksheetHeaderRows, WorkbookParserError } from "../workbookParser";
import { createImportBatchStorage } from "../importBatch/compositionRoot";
import { getMessageTemplate, type FailureCode } from "../importBatch/failureTaxonomy";
import {
  GOVERNED_DATASET_TYPE_ID,
  GOVERNED_DATASET_TYPE_NAME,
  GOVERNED_SOURCE_SCHEMA_VERSION_ID,
  GOVERNED_SOURCE_SCHEMA_VERSION_NUMBER,
  loadGovernedSchemaForSourceSystem,
} from "./governedSchema";
import { matchObservedWorkbookStructure, planHeaderRowReads, type ObservedWorksheetInput } from "./schemaMatcher";

// Data Hub 6.2D3D — governed schema ELIGIBILITY and LINEAGE PINNING for one
// XLSX ImportBatch. A manager may durably bind a READY XLSX batch to its
// governed DatasetType + exact ACTIVE SourceSchemaVersion, but ONLY after
// the server independently re-verifies every fact itself: tenant ownership,
// physical/format eligibility, SourceSystem lineage, governed-schema
// resolution, ACTIVE status, storage integrity, and a FRESH structural
// EXACT_MATCH. On success, ImportBatch.dataset_type_id and
// .source_schema_version_id are atomically frozen together, once, forever
// — this service never replaces, upgrades, clears or re-pins existing
// lineage. See D3C's matchImportBatchSchema.ts for the read-only sibling
// this reuses (governed-schema resolution, the pure matcher, and the exact
// same storage/hash/parse discipline) and governedSchema.ts for why a
// caller can never choose the schema: both are resolved SERVER-SIDE from
// the batch's own persisted source_system_id, never from any input.
//
// TRUSTED INPUT ONLY: { organisationId, importBatchId, actorUserId }. No
// sourceSystemId/datasetTypeId/sourceSchemaVersionId/schemaMatchResult/
// override/filename/sha256/worksheet id is ever accepted — every one of
// those is independently re-derived or re-verified from trusted DB/storage
// state inside this function. actorUserId is accepted for parity with the
// route's session shape and future audit use; this phase does not persist
// it anywhere (no audit table write exists yet for this lineage event).
//
// CONCURRENCY: the service owns correctness entirely via ONE atomic
// conditional `updateMany` whose WHERE clause repeats every MUTABLE
// PERSISTED IMPORTBATCH CLAIM PRECONDITION (id, organisation_id, deleted_at,
// status, source_system_id, and the "still unpinned" dataset_type_id IS
// NULL AND source_schema_version_id IS NULL pair) — never a route-level
// read-before-write, never last-writer-wins. Storage/hash/structural
// eligibility (Steps 8-9 below) is freshly verified BEFORE this claim is
// attempted, not repeated inside the WHERE clause itself — Postgres has no
// way to re-check "the workbook bytes still hash-match and structurally
// match the governed schema" as part of a single UPDATE's WHERE predicate,
// so that verification's freshness is what makes the claim trustworthy, not
// the WHERE clause re-stating it. A losing concurrent caller re-reads the
// now-durable lineage and converges to either an idempotent 200 (identical
// lineage) or SCHEMA_LINEAGE_CONFLICT (different lineage) — it can never
// silently switch an already-pinned batch to a different schema.
//
// RETIRED / HISTORICAL IDEMPOTENCY: D3C's own read-only governed-schema
// loader (governedSchema.ts, untouched by this file) intentionally never
// surfaces a RETIRED SourceSchemaVersion — READABLE_SCHEMA_STATUSES is
// DRAFT|ACTIVE only, so a RETIRED version is indistinguishable from "no
// governed schema at all" from that loader's own perspective. This file
// therefore NEVER relies on the loader to answer "is this batch's EXISTING
// lineage still the governed one" — Step 5 below resolves that purely from
// this batch's own persisted lineage columns compared against the fixed,
// server-owned governed identifiers, so a batch legitimately pinned while
// the schema was ACTIVE keeps returning idempotent success after that
// schema is later RETIRED, with zero storage/loader work. For a genuinely
// UNPINNED batch, distinguishing "RETIRED" from "truly unavailable" (so the
// former reports GOVERNED_SCHEMA_NOT_ACTIVE, matching DRAFT, rather than
// GOVERNED_SCHEMA_UNAVAILABLE) uses a narrow, D3D-local lifecycle check
// (resolveRetiredGovernedSchemaLifecycle below) that reads the SAME rows
// the loader would, but never widens what the loader itself returns or how
// the D3C GET route behaves.
//
// NOT DONE HERE (deliberately out of D3D's scope): schema activation,
// schema editing/versioning, mapping-profile activation, drift
// acknowledgement/override, XLSX row staging/canonical import, reporting
// period, reconciliation. This service performs exactly one write: the two
// ImportBatch lineage columns, nothing else.

export type SchemaSelectionSuccess = {
  ok: true;
  alreadySelected: boolean;
  importBatchId: string;
  datasetTypeId: string;
  sourceSchemaVersionId: string;
  sourceSchemaVersionNumber: number;
};

export type SchemaSelectionFailureCode =
  | "BATCH_NOT_FOUND"
  | "BATCH_NOT_READY"
  | "UNSUPPORTED_FORMAT"
  | "SOURCE_LINEAGE_REQUIRED"
  | "GOVERNED_SCHEMA_UNAVAILABLE"
  | "GOVERNED_SCHEMA_NOT_ACTIVE"
  | "SCHEMA_EXACT_MATCH_REQUIRED"
  | "STORAGE_NOT_FOUND"
  | "PROVIDER_FAILURE"
  | "STORAGE_INTEGRITY_MISMATCH"
  | "PARSER_REJECTED"
  | "SCHEMA_LINEAGE_CONFLICT"
  | "INVALID_STATE";

export type SchemaSelectionFailure = { ok: false; code: SchemaSelectionFailureCode; message: string };

export type SchemaSelectionOutcome = SchemaSelectionSuccess | SchemaSelectionFailure;

// D3D-local, caller-only messages for the codes this phase introduces —
// never persisted, never distinguishing between the several distinct
// reasons folded into one code, mirroring matchImportBatchSchema.ts's own
// GOVERNED_SCHEMA_UNAVAILABLE_MESSAGE precedent exactly (same reasons: a
// missing/inactive/unexpected-identity/cross-tenant governed schema is
// never distinguishable from this message alone).
const GOVERNED_SCHEMA_UNAVAILABLE_MESSAGE =
  "No governed source schema is available to compare this workbook against. No changes were made.";
const GOVERNED_SCHEMA_NOT_ACTIVE_MESSAGE =
  "The governed source schema for this workbook is not currently active for imports. No changes were made.";
const SCHEMA_EXACT_MATCH_REQUIRED_MESSAGE =
  "This workbook does not exactly match the governed source schema's structure. No changes were made.";
const SCHEMA_LINEAGE_CONFLICT_MESSAGE =
  "This import batch is already bound to a different governed dataset and schema version. No changes were made.";

const SHARED_MESSAGE_CODES = new Set<SchemaSelectionFailureCode>([
  "BATCH_NOT_FOUND",
  "BATCH_NOT_READY",
  "UNSUPPORTED_FORMAT",
  "SOURCE_LINEAGE_REQUIRED",
  "STORAGE_NOT_FOUND",
  "PROVIDER_FAILURE",
  "STORAGE_INTEGRITY_MISMATCH",
  "PARSER_REJECTED",
  "INVALID_STATE",
]);

function fail(code: SchemaSelectionFailureCode): SchemaSelectionOutcome {
  if (SHARED_MESSAGE_CODES.has(code)) {
    return { ok: false, code, message: getMessageTemplate(code as FailureCode) };
  }
  const message =
    code === "GOVERNED_SCHEMA_UNAVAILABLE"
      ? GOVERNED_SCHEMA_UNAVAILABLE_MESSAGE
      : code === "GOVERNED_SCHEMA_NOT_ACTIVE"
        ? GOVERNED_SCHEMA_NOT_ACTIVE_MESSAGE
        : code === "SCHEMA_EXACT_MATCH_REQUIRED"
          ? SCHEMA_EXACT_MATCH_REQUIRED_MESSAGE
          : SCHEMA_LINEAGE_CONFLICT_MESSAGE;
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

export interface EstablishImportBatchSchemaLineageContext {
  /** Trusted, already-authenticated caller context — never re-derived here. */
  organisationId: string;
  importBatchId: string;
  actorUserId: string;
}

// D3D-LOCAL LIFECYCLE CHECK — invoked ONLY after governedSchema.ts's own
// loader has already returned `ok: false` for this tenant + source system,
// and ONLY to decide between two already-failing outcomes
// (GOVERNED_SCHEMA_NOT_ACTIVE vs GOVERNED_SCHEMA_UNAVAILABLE) for an
// UNPINNED batch — never a second resolution path a client could reach any
// governed schema through, and never reused by (or exposed to) D3C's GET
// route. Mirrors governedSchema.ts's own tenant/coherence rigor exactly
// (SourceSystem -> DatasetType -> SourceSchemaVersion, each step re-checking
// organisation_id/source_system_id/dataset_type_id) but reads ONLY the
// `status` column, and NEVER reads worksheets/columns/profile rows — this
// function can only ever answer true/false, never supply schema content.
// governedSchema.ts's own READABLE_SCHEMA_STATUSES set and the D3C GET
// route are both untouched by this function's existence.
async function resolveRetiredGovernedSchemaLifecycle(organisationId: string, sourceSystemId: string): Promise<boolean> {
  const sourceSystem = await prisma.sourceSystem.findFirst({
    where: { id: sourceSystemId, organisation_id: organisationId },
    select: { id: true, organisation_id: true },
  });
  if (!sourceSystem || sourceSystem.organisation_id !== organisationId) return false;

  const datasetType = await prisma.datasetType.findFirst({
    where: { organisation_id: organisationId, source_system_id: sourceSystemId, name: GOVERNED_DATASET_TYPE_NAME },
    select: { id: true, organisation_id: true, source_system_id: true, active: true },
  });
  if (
    !datasetType ||
    datasetType.organisation_id !== organisationId ||
    datasetType.source_system_id !== sourceSystemId ||
    datasetType.id !== GOVERNED_DATASET_TYPE_ID ||
    datasetType.active !== true
  ) {
    return false;
  }

  const version = await prisma.sourceSchemaVersion.findFirst({
    where: { organisation_id: organisationId, dataset_type_id: datasetType.id, version_number: GOVERNED_SOURCE_SCHEMA_VERSION_NUMBER },
    select: { id: true, organisation_id: true, dataset_type_id: true, status: true },
  });
  if (!version || version.organisation_id !== organisationId || version.dataset_type_id !== datasetType.id || version.id !== GOVERNED_SOURCE_SCHEMA_VERSION_ID) {
    return false;
  }

  return version.status === "RETIRED";
}

export async function establishImportBatchSchemaLineage(
  context: EstablishImportBatchSchemaLineageContext
): Promise<SchemaSelectionOutcome> {
  const { organisationId, importBatchId } = context;

  // ---- Step 1 — tenant-scoped batch lookup. Nonexistent, wrong-tenant and
  // tombstoned all collapse into BATCH_NOT_FOUND — never leaks cross-tenant
  // existence. ----
  const batch = await prisma.importBatch.findUnique({
    where: { id_organisation_id: { id: importBatchId, organisation_id: organisationId } },
    select: {
      status: true,
      deleted_at: true,
      sha256: true,
      content_type: true,
      original_filename: true,
      source_system_id: true,
      dataset_type_id: true,
      source_schema_version_id: true,
    },
  });
  if (!batch || batch.deleted_at !== null) return fail("BATCH_NOT_FOUND");

  // ---- Step 2 — physical batch state. ----
  if (batch.status !== "READY") return fail("BATCH_NOT_READY");

  // ---- Step 3 — XLSX scope, authoritative persisted format only (never a
  // browser-supplied filename alone). ----
  if (batch.content_type !== "xlsx" || !filenameClassifiesAsXlsx(batch.original_filename)) {
    return fail("UNSUPPORTED_FORMAT");
  }
  if (!batch.sha256) return fail("PROVIDER_FAILURE");

  // ---- Step 4 — SourceSystem lineage required; D3D never infers or
  // repairs it. ----
  const sourceSystemId = batch.source_system_id;
  if (sourceSystemId === null) return fail("SOURCE_LINEAGE_REQUIRED");

  // ---- Existing pinned lineage (Section 6) — resolved BEFORE the D3C
  // governed-schema loader is ever called, and using ONLY the fixed,
  // server-owned governed identifiers (GOVERNED_DATASET_TYPE_ID /
  // GOVERNED_SOURCE_SCHEMA_VERSION_ID) compared against this batch's own
  // trusted, already-persisted lineage columns — never the loader's
  // output. This is deliberate: the loader would return `ok: false` for a
  // RETIRED schema (D3C's own READABLE_SCHEMA_STATUSES is DRAFT|ACTIVE
  // only), and a batch legitimately pinned while the schema was ACTIVE
  // must keep returning idempotent success after that schema is later
  // RETIRED — checking idempotency here, first, makes that true without
  // ever touching the loader, storage, or the parser for an
  // already-pinned batch. Both null -> continue to new-selection
  // eligibility below. Both populated and equal to the fixed governed
  // pair -> idempotent success, zero mutation, zero storage/parser work.
  // Both populated and different -> frozen-lineage conflict, never
  // replaced. Exactly one populated is an anomalous state the DB's own
  // implication CHECK constraints should make unreachable — fail closed,
  // never repaired. ----
  const existingDatasetTypeId = batch.dataset_type_id;
  const existingSchemaVersionId = batch.source_schema_version_id;
  if (existingDatasetTypeId !== null || existingSchemaVersionId !== null) {
    if (existingDatasetTypeId === null || existingSchemaVersionId === null) {
      return fail("INVALID_STATE");
    }
    if (existingDatasetTypeId === GOVERNED_DATASET_TYPE_ID && existingSchemaVersionId === GOVERNED_SOURCE_SCHEMA_VERSION_ID) {
      return {
        ok: true,
        alreadySelected: true,
        importBatchId,
        datasetTypeId: GOVERNED_DATASET_TYPE_ID,
        sourceSchemaVersionId: GOVERNED_SOURCE_SCHEMA_VERSION_ID,
        sourceSchemaVersionNumber: GOVERNED_SOURCE_SCHEMA_VERSION_NUMBER,
      };
    }
    return fail("SCHEMA_LINEAGE_CONFLICT");
  }

  // ---- Governed schema resolution (Section 7) — server-derived only, from
  // this batch's own trusted tenant + source system. The client never
  // selects the schema. Only reached for a genuinely UNPINNED batch. ----
  const governed = await loadGovernedSchemaForSourceSystem({ organisationId, sourceSystemId });
  if (!governed.ok) {
    // The loader itself cannot distinguish "no governed schema at all"
    // from "the governed schema exists but is RETIRED" (both return
    // `ok: false` from governedSchema.ts by design). Resolve that
    // distinction locally, without ever widening the loader's own
    // read boundary or touching the D3C GET route.
    const retired = await resolveRetiredGovernedSchemaLifecycle(organisationId, sourceSystemId);
    return fail(retired ? "GOVERNED_SCHEMA_NOT_ACTIVE" : "GOVERNED_SCHEMA_UNAVAILABLE");
  }

  // governedSchema.ts's LoadGovernedSchemaResult does not itself return the
  // resolved DatasetType id (only the schema/version) — governedSchema.ts
  // already independently verified this batch's tenant + source system
  // resolves to exactly GOVERNED_DATASET_TYPE_ID before returning `ok:
  // true`, so reusing that same fixed, server-owned constant here (never
  // any caller input) is safe and avoids duplicating its resolution logic.
  const datasetTypeId = GOVERNED_DATASET_TYPE_ID;

  // ---- ACTIVE-only rule (Section 8). DRAFT is rejected here; RETIRED is
  // never reachable at this point (the loader above never returns `ok:
  // true` for a RETIRED version), so this branch in practice only ever
  // fires for DRAFT. ----
  if (governed.schema.status !== "ACTIVE") return fail("GOVERNED_SCHEMA_NOT_ACTIVE");

  // ---- Fresh schema comparison (Section 9) — never trusts a prior GET's
  // result. Same authoritative storage retrieval / bounded read / SHA-256
  // re-verification / worksheet structural re-verification / matcher
  // invocation as D3C's own matchImportBatchSchema.ts, deliberately
  // re-executed (not cached) so this mutation can never rely on a
  // browser-visible, replayable prior report. ----
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

  const report = matchObservedWorkbookStructure({ observed: { worksheets: observed }, governedSchema: governed.schema });

  // ---- Match eligibility (Section 10) — only a fresh EXACT_MATCH may
  // proceed. No warning acknowledgement or override exists in D3D. ----
  if (report.result !== "EXACT_MATCH") return fail("SCHEMA_EXACT_MATCH_REQUIRED");

  // ---- Atomic conditional lineage pin (Section 11/12). The WHERE clause
  // repeats the mutable PERSISTED ImportBatch claim preconditions (id,
  // organisation_id, deleted_at, status, source_system_id) PLUS the "still
  // unpinned" precondition — it does NOT repeat the storage/hash/structural
  // eligibility just verified above (Postgres cannot express "the workbook
  // still hash-matches and structurally matches" inside an UPDATE's WHERE
  // clause); that freshness comes from having just re-verified it, not from
  // restating it here. This single UPDATE statement is Postgres's own
  // atomicity boundary; no wrapping transaction and no earlier read is
  // trusted as the concurrency mechanism. ----
  const claim = await prisma.importBatch.updateMany({
    where: {
      id: importBatchId,
      organisation_id: organisationId,
      deleted_at: null,
      status: "READY",
      source_system_id: sourceSystemId,
      dataset_type_id: null,
      source_schema_version_id: null,
    },
    data: { dataset_type_id: datasetTypeId, source_schema_version_id: governed.schema.sourceSchemaVersionId },
  });

  if (claim.count === 1) {
    return {
      ok: true,
      alreadySelected: false,
      importBatchId,
      datasetTypeId,
      sourceSchemaVersionId: governed.schema.sourceSchemaVersionId,
      sourceSchemaVersionNumber: governed.schema.versionNumber,
    };
  }

  // ---- Lost the atomic claim to a concurrent caller (or the batch's own
  // authoritative state changed between the reads above and this write).
  // Re-read authoritative state and converge: identical lineage now durable
  // -> idempotent success; different lineage -> conflict; anything else
  // (batch no longer eligible for reasons other than lineage) -> fail
  // closed, never repaired, never a partial/mixed result. ----
  const reread = await prisma.importBatch.findUnique({
    where: { id_organisation_id: { id: importBatchId, organisation_id: organisationId } },
    select: { dataset_type_id: true, source_schema_version_id: true },
  });
  if (
    reread &&
    reread.dataset_type_id === datasetTypeId &&
    reread.source_schema_version_id === governed.schema.sourceSchemaVersionId
  ) {
    return {
      ok: true,
      alreadySelected: true,
      importBatchId,
      datasetTypeId,
      sourceSchemaVersionId: governed.schema.sourceSchemaVersionId,
      sourceSchemaVersionNumber: governed.schema.versionNumber,
    };
  }
  if (reread && (reread.dataset_type_id !== null || reread.source_schema_version_id !== null)) {
    return fail("SCHEMA_LINEAGE_CONFLICT");
  }
  return fail("INVALID_STATE");
}
