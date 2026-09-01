import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { buildImportBatchKey, RawFileStoreError } from "../storage/rawFileStore";
import { createImportBatchStorage } from "./compositionRoot";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import { inspectWorkbook, WorkbookParserError, type WorksheetVisibility } from "../workbookParser";
import { getMessageTemplate, type FailureCode } from "./failureTaxonomy";

// Data Hub 5A.2H.1 — worksheet inspection/persistence service (dark,
// route-free, transport-independent).
//
// AUTH BOUNDARY: exactly the same discipline as initiate.ts/finalize.ts —
// this function accepts an already-resolved trusted context
// (organisationId, importBatchId) as plain parameters. It never attempts
// to resolve its own auth/session, and it deliberately never imports
// lib/org.ts's requireRole/requireSession: those depend on next/headers'
// cookies() and server-only, and physically cannot run outside a real
// Next.js request context. A FUTURE route wrapping this service MUST
// enforce manager+ role authorization (via requireRole('manager')) BEFORE
// ever calling it, and MUST derive organisationId from a real,
// authenticated session, never from arbitrary request input. This is
// deferred because there is NO runtime caller of any kind in this slice —
// see tests/containment/dataHubImportBatchDarkness.test.ts and
// tests/containment/inspectWorksheets.test.ts for the static darkness
// proof.
//
// WHAT THIS SERVICE OWNS: given a READY ImportBatch, it re-fetches and
// re-verifies the physical bytes, runs structural-only workbook
// inspection (inspectWorkbook — never decodeWorksheet, never preview/cell
// content), and persists one canonical Upload row per worksheet
// (lineage_kind = 'DATA_HUB'). It NEVER writes to ImportBatch's own
// columns on any path (success or failure) — the physical
// finalization lifecycle (initiate.ts/finalize.ts/finalizeInternal.ts) is
// already complete and historically fixed by the time this service ever
// runs. It NEVER persists preview rows, headers, cell values, mapping
// data, validation results, schema classification, or row/column counts
// — see PersistedWorksheetDescriptor below for the exact structural-only
// shape this service is allowed to write.
//
// XLSX ACCESS DISCIPLINE (opposite of finalize.ts): finalize.ts must NOT
// import workbookParser.ts at all (its whole purpose is to complete the
// physical file lifecycle without ever invoking SheetJS). This service's
// whole purpose is the reverse — to safely invoke inspectWorkbook from a
// dark, already-verified-bytes-only context, on a batch whose physical
// bytes have already been durably stored and hashed. This file imports
// `xlsx` from nowhere directly; the only path to SheetJS is
// inspectWorkbook, imported from workbookParser.ts.

export type WorksheetCanonicalStatus = "AWAITING_CONFIRMATION" | "INELIGIBLE";

export interface InspectWorksheetsTrustedContext {
  /** Trusted, already-authenticated caller context — never re-derived here. */
  organisationId: string;
  importBatchId: string;
}

/**
 * Structural worksheet metadata only — see the module header comment.
 * worksheetIndex is the authoritative identity (matches workbookParser's
 * own zero-based, index-based contract); worksheetName is descriptive
 * only.
 */
export interface PersistedWorksheetDescriptor {
  worksheetIndex: number;
  worksheetName: string;
  worksheetVisibility: WorksheetVisibility;
  worksheetIsEmpty: boolean;
  canonicalStatus: WorksheetCanonicalStatus;
}

// Reuses the existing Data Hub failure taxonomy rather than introducing a
// parallel one (Step 19 / architecture review). STORAGE_NOT_FOUND and
// PROVIDER_FAILURE already exist there as PersistedFailureCode members
// (owned by the physical finalize lifecycle) — reused here purely as
// CALLER-FACING outcome codes for THIS service; this service never writes
// either of them (or any other code) to ImportBatch.last_failure_code, so
// reusing the string values creates no ambiguity about which lifecycle
// "owns" a persisted failure. BATCH_NOT_FOUND, BATCH_NOT_READY,
// STORAGE_INTEGRITY_MISMATCH, PARSER_REJECTED, and PERSISTENCE_CONFLICT
// are new CallerOnlyOutcomeCode members added by this phase — see
// failureTaxonomy.ts.
export type InspectWorksheetsFailureCode =
  | "BATCH_NOT_FOUND"
  | "BATCH_NOT_READY"
  | "STORAGE_NOT_FOUND"
  | "PROVIDER_FAILURE"
  | "STORAGE_INTEGRITY_MISMATCH"
  | "PARSER_REJECTED"
  | "PERSISTENCE_CONFLICT";

export type InspectWorksheetsResult =
  | { ok: true; worksheets: PersistedWorksheetDescriptor[] }
  | { ok: false; code: InspectWorksheetsFailureCode; message: string };

function fail(code: InspectWorksheetsFailureCode): InspectWorksheetsResult {
  // getMessageTemplate accepts the broader FailureCode union; every literal
  // in InspectWorksheetsFailureCode is a member of it (see failureTaxonomy.ts).
  return { ok: false, code, message: getMessageTemplate(code as FailureCode) };
}

// ---------------------------------------------------------------------------
// Step 11 — initial status assignment. Exactly: visible AND non-empty ->
// AWAITING_CONFIRMATION; every other combination (hidden, veryHidden, or
// empty regardless of visibility) -> INELIGIBLE. This service never writes
// FAILED (not a valid canonical_status value — see the DB CHECK constraint
// in scripts/create-import-batches.sql), and never writes SKIPPED or
// IMPORTED (later, separate transitions this slice never performs).
// ---------------------------------------------------------------------------
function deriveCanonicalStatus(visibility: WorksheetVisibility, isEmpty: boolean): WorksheetCanonicalStatus {
  if (visibility === "visible" && !isEmpty) return "AWAITING_CONFIRMATION";
  return "INELIGIBLE";
}

// ---------------------------------------------------------------------------
// Step 12 — legacy NOT-NULL compatibility fields for the shared `uploads`
// table. worksheet_index remains the sole authoritative identity for every
// one of these; none of them is ever used for lookup.
// ---------------------------------------------------------------------------

// Physical-file content-type/MIME semantics only — describes the parent
// ImportBatch's format, never a worksheet-specific MIME object (a
// worksheet has no independent MIME type of its own).
const CONTENT_TYPE_TO_MIMETYPE: Record<string, string> = {
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function resolveLegacyMimetype(contentType: string): string {
  return CONTENT_TYPE_TO_MIMETYPE[contentType] ?? "application/octet-stream";
}

// Display/compatibility-only — combines the physical filename with the
// worksheet's own descriptive identity. Never used for lookup.
function buildLegacyOriginalName(originalFilename: string, descriptor: PersistedWorksheetDescriptor): string {
  return `${originalFilename} :: worksheet[${descriptor.worksheetIndex}] "${descriptor.worksheetName}"`;
}

// Deliberately non-operable sentinel (Step 12). Contains ':' — verified
// against RawFileStore's real validateStorageKey (rawFileStore.ts), which
// rejects any key containing a colon — see
// tests/containment/inspectWorksheets.test.ts's dedicated proof that this
// exact value is rejected as INVALID_KEY if ever mistakenly passed to
// buildImportBatchKey/head()/get()/delete(). Physical object ownership
// belongs exclusively to ImportBatch (via its own storage_key column);
// Upload.stored_path is intentionally non-operable for every DATA_HUB-
// lineage row. Do NOT modify RawFileStore's validation to special-case
// this value — it must remain rejected by the EXISTING, unmodified
// validation logic.
function buildStoredPathSentinel(importBatchId: string, worksheetIndex: number): string {
  return `datahub-worksheet:${importBatchId}:${worksheetIndex}`;
}

// ---------------------------------------------------------------------------
// Step 14 — existing persisted set policy. Compares a fresh, expected
// ordered descriptor set against an existing tenant-scoped DATA_HUB Upload
// row set for the same batch, per the five-case policy documented on
// inspectWorksheets() below. Returns "MATCH" only for an exact,
// field-for-field match against every expected descriptor; every other
// shape (partial, extra, divergent) is "CONFLICT" — never repaired,
// topped-up, or overwritten.
// ---------------------------------------------------------------------------

interface ExistingUploadRow {
  organisation_id: string;
  import_batch_id: string | null;
  worksheet_index: number | null;
  worksheet_name: string | null;
  worksheet_visibility: string | null;
  worksheet_is_empty: boolean | null;
  lineage_kind: string;
  canonical_status: string | null;
}

function classifyExistingSet(
  existing: ExistingUploadRow[],
  expected: PersistedWorksheetDescriptor[],
  organisationId: string,
  importBatchId: string
): "MATCH" | "CONFLICT" {
  // Case C (partial) and the count-based half of Case D (extra rows) are
  // both a length mismatch against the fresh N-row expectation.
  if (existing.length !== expected.length) return "CONFLICT";

  const expectedByIndex = new Map(expected.map((descriptor) => [descriptor.worksheetIndex, descriptor]));
  const seenIndices = new Set<number>();

  for (const row of existing) {
    if (
      row.organisation_id !== organisationId ||
      row.import_batch_id !== importBatchId ||
      row.lineage_kind !== "DATA_HUB" ||
      row.worksheet_index === null
    ) {
      return "CONFLICT";
    }
    if (seenIndices.has(row.worksheet_index)) return "CONFLICT";
    seenIndices.add(row.worksheet_index);

    // The index-beyond-fresh-set half of Case D — a row whose index the
    // fresh derivation no longer produces at all.
    const expectedDescriptor = expectedByIndex.get(row.worksheet_index);
    if (!expectedDescriptor) return "CONFLICT";

    // Case E — same index, divergent structural metadata.
    if (
      row.worksheet_name !== expectedDescriptor.worksheetName ||
      row.worksheet_visibility !== expectedDescriptor.worksheetVisibility ||
      row.worksheet_is_empty !== expectedDescriptor.worksheetIsEmpty ||
      row.canonical_status !== expectedDescriptor.canonicalStatus
    ) {
      return "CONFLICT";
    }
  }

  return "MATCH";
}

async function readExistingDataHubUploads(organisationId: string, importBatchId: string): Promise<ExistingUploadRow[]> {
  return prisma.upload.findMany({
    where: { organisation_id: organisationId, import_batch_id: importBatchId, lineage_kind: "DATA_HUB" },
    orderBy: { worksheet_index: "asc" },
    select: {
      organisation_id: true,
      import_batch_id: true,
      worksheet_index: true,
      worksheet_name: true,
      worksheet_visibility: true,
      worksheet_is_empty: true,
      lineage_kind: true,
      canonical_status: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Step 15 — first-time atomic persistence (Case A only). One atomic
// createMany WITHOUT skipDuplicates, so a genuine unique-constraint
// violation from a concurrent racer throws rather than being silently
// absorbed. On a real P2002, re-reads the tenant-scoped set and re-runs
// the exact same Case B/C/D/E comparison: an exact match means the racing
// caller persisted the identical correct data (idempotent success); any
// divergence is PERSISTENCE_CONFLICT. Any other thrown error is an
// unexpected failure — propagated as a new, sanitized Error (never the
// raw caught error's own message text).
// ---------------------------------------------------------------------------
async function persistFirstTime(
  organisationId: string,
  importBatchId: string,
  contentType: string,
  originalFilename: string,
  expected: PersistedWorksheetDescriptor[]
): Promise<InspectWorksheetsResult> {
  const mimetype = resolveLegacyMimetype(contentType);

  const data: Prisma.UploadCreateManyInput[] = expected.map((descriptor) => ({
    organisation_id: organisationId,
    original_name: buildLegacyOriginalName(originalFilename, descriptor),
    stored_path: buildStoredPathSentinel(importBatchId, descriptor.worksheetIndex),
    mimetype,
    // Legacy-compatibility sentinel (Step 12) — NEVER the physical
    // ImportBatch.size_bytes. The physical object's real size belongs
    // exclusively to ImportBatch; duplicating it across every worksheet
    // row here would create false accounting if anything ever sums
    // Upload.size_bytes across rows. 0 is not a measurement of anything.
    size_bytes: 0,
    import_batch_id: importBatchId,
    worksheet_index: descriptor.worksheetIndex,
    worksheet_name: descriptor.worksheetName,
    worksheet_visibility: descriptor.worksheetVisibility,
    worksheet_is_empty: descriptor.worksheetIsEmpty,
    lineage_kind: "DATA_HUB",
    canonical_status: descriptor.canonicalStatus,
    // last_attempt_at/attempt_count/last_failure_code/last_failure_message/
    // last_failure_retryable are all deliberately OMITTED — they must be
    // left at their schema defaults (attempt_count=0, the rest NULL) per
    // Step 18. A later phase's worksheet-level import-attempt tracking
    // owns those columns, not this inspection step.
  }));

  try {
    await prisma.upload.createMany({ data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await readExistingDataHubUploads(organisationId, importBatchId);
      const comparison = classifyExistingSet(existing, expected, organisationId, importBatchId);
      if (comparison === "MATCH") {
        return { ok: true, worksheets: expected };
      }
      return fail("PERSISTENCE_CONFLICT");
    }
    // Unexpected failure — never let the raw caught error's own message
    // text escape. No dedicated taxonomy code exists for this (nor is one
    // needed per the architecture review); propagate a new, sanitized
    // Error instead of the original.
    throw new Error("inspectWorksheets: unexpected failure during first-time worksheet persistence.", { cause: err });
  }

  return { ok: true, worksheets: expected };
}

/**
 * Inspects a READY ImportBatch's worksheets and persists structural-only
 * worksheet lineage (one canonical Upload row per worksheet,
 * lineage_kind = 'DATA_HUB'). Idempotent: an exact-match retry against an
 * already-persisted set returns success without writing anything; any
 * other divergence from the freshly-derived expected set is a hard
 * PERSISTENCE_CONFLICT — never topped up, overwritten, or truncated.
 *
 * Flow: tenant-scoped ImportBatch lookup (requires status='READY') ->
 * derive the canonical storage key -> bounded RawFileStore.get() ->
 * mandatory SHA-256 re-verification against the batch's own persisted
 * sha256 -> inspectWorkbook (structural inspection only) -> map to
 * structural-only descriptors -> compare against any existing DATA_HUB
 * Upload rows per the five-case policy -> persist (Case A) or return
 * success/PERSISTENCE_CONFLICT (Cases B-E).
 */
export async function inspectWorksheets(context: InspectWorksheetsTrustedContext): Promise<InspectWorksheetsResult> {
  const { organisationId, importBatchId } = context;

  // ---- Step 6 — tenant-scoped batch lookup. id AND organisation_id are
  // filtered in the SAME predicate via the compound unique key backing
  // ImportBatch's own @@unique([id, organisation_id]) — never a global
  // lookup by id alone. A wrong-organisation batch and a genuinely
  // nonexistent batch id produce the identical BATCH_NOT_FOUND result. ----
  const batch = await prisma.importBatch.findUnique({
    where: { id_organisation_id: { id: importBatchId, organisation_id: organisationId } },
    select: { status: true, original_filename: true, content_type: true, sha256: true },
  });
  if (!batch) {
    return fail("BATCH_NOT_FOUND");
  }
  if (batch.status !== "READY") {
    return fail("BATCH_NOT_READY");
  }

  // Defensive: the import_batches_ready_requires_sha256 DB CHECK should
  // make a READY row with a NULL sha256 structurally impossible. Treated
  // as a PROVIDER_FAILURE-shaped outcome (not a distinct new code) because
  // it represents unexpected, should-be-impossible data state, not a
  // normal user-facing case.
  if (!batch.sha256) {
    return fail("PROVIDER_FAILURE");
  }

  // ---- Step 7 — storage retrieval, via the existing composition root /
  // buildImportBatchKey only — never a caller-provided path, never a
  // directly-constructed Blob client. ----
  const storage = createImportBatchStorage();
  const storageKey = buildImportBatchKey(organisationId, importBatchId);

  let getResult;
  try {
    getResult = await storage.get(storageKey, { maxBytes: MAX_SOURCE_FILE_BYTES });
  } catch (err) {
    if (err instanceof RawFileStoreError && err.code === "NOT_FOUND") {
      return fail("STORAGE_NOT_FOUND");
    }
    // Every other RawFileStoreErrorCode (or any non-RawFileStoreError
    // throw) collapses to PROVIDER_FAILURE — RawFileStore.get() already
    // internally normalizes size-mismatch/etag-mismatch/etc., so no
    // separate code is re-derived here.
    return fail("PROVIDER_FAILURE");
  }

  // ---- Step 8 — mandatory SHA-256 re-verification. Runs unconditionally,
  // every invocation, against the batch's own persisted sha256 column —
  // never expected_sha256. ----
  const computedSha256 = createHash("sha256").update(getResult.body).digest("hex");
  if (computedSha256 !== batch.sha256) {
    return fail("STORAGE_INTEGRITY_MISMATCH");
  }

  // ---- Step 9 — structural workbook inspection only. inspectWorkbook,
  // never decodeWorksheet. Any WorkbookParserError collapses to the single
  // PARSER_REJECTED code — its own code/message text is never leaked. ----
  let inspection;
  try {
    inspection = await inspectWorkbook(getResult.body, { filename: batch.original_filename });
  } catch (err) {
    if (err instanceof WorkbookParserError) {
      return fail("PARSER_REJECTED");
    }
    throw err;
  }

  // ---- Step 16 — complete-set invariant. A successful inspectWorkbook
  // call structurally cannot return zero worksheets (CSV: always exactly
  // one; XLS/XLSX: a zero-sheet workbook throws MALFORMED_WORKBOOK before
  // any WorksheetInspection is ever constructed — see
  // workbookParser.ts's readSheetNamesOnly). This assertion exists because
  // this service's persistence design depends on that invariant, not
  // because it is expected to ever trip in practice.
  if (inspection.worksheets.length === 0) {
    throw new Error("inspectWorksheets: invariant violated — a successful inspectWorkbook returned zero worksheets.");
  }

  // ---- Step 10/11 — structural-only descriptors + status assignment. ----
  const expected: PersistedWorksheetDescriptor[] = inspection.worksheets.map((worksheet) => ({
    worksheetIndex: worksheet.index,
    worksheetName: worksheet.name,
    worksheetVisibility: worksheet.visibility,
    worksheetIsEmpty: worksheet.isEmpty,
    canonicalStatus: deriveCanonicalStatus(worksheet.visibility, worksheet.isEmpty),
  }));

  // ---- Step 14 — existing persisted set policy. ----
  const existing = await readExistingDataHubUploads(organisationId, importBatchId);

  if (existing.length === 0) {
    // Case A.
    return persistFirstTime(organisationId, importBatchId, batch.content_type, batch.original_filename, expected);
  }

  const comparison = classifyExistingSet(existing, expected, organisationId, importBatchId);
  if (comparison === "MATCH") {
    // Case B — idempotent success, nothing written.
    return { ok: true, worksheets: expected };
  }
  // Cases C, D, E — never topped up, truncated, or overwritten.
  return fail("PERSISTENCE_CONFLICT");
}
