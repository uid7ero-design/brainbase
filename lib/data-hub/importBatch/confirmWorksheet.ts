import { createHash } from "node:crypto";
import { prisma } from "../../prisma";
import { buildImportBatchKey, RawFileStoreError } from "../storage/rawFileStore";
import { createImportBatchStorage } from "./compositionRoot";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import { decodeCsvOnly, CsvOnlyDecodeError } from "../csvOnlyDecoder";
import { mapIllegalDumpingRows, IllegalDumpingMappingError } from "./illegalDumpingMapper";
import { getMessageTemplate, type FailureCode } from "./failureTaxonomy";

// Data Hub 5A.2K.1 — dark canonical DATA_HUB worksheet confirmation +
// illegal-dumping transactional importer service (dark, route-free,
// transport-independent, CSV-scoped).
//
// AUTH BOUNDARY: exactly the same discipline as every other importBatch
// service (initiate.ts/finalize.ts/inspectWorksheets.ts) — this function
// accepts an already-resolved trusted context (organisationId,
// worksheetUploadId) as plain parameters. It never attempts to resolve its
// own auth/session, and never imports lib/org.ts. A FUTURE route wrapping
// this service MUST enforce manager+ role authorization BEFORE ever calling
// it, and MUST derive organisationId from a real, authenticated session,
// never from arbitrary request input. This is deferred because there is NO
// runtime caller of any kind in this slice — see
// tests/containment/dataHubImportBatchDarkness.test.ts and
// tests/containment/confirmWorksheet.test.ts for the static darkness proof.
//
// TRUSTED INPUT ONLY: the caller supplies exactly {organisationId,
// worksheetUploadId} — nothing else. Storage locator, ImportBatch identity,
// worksheet name, lineage, and canonical_status are ALL resolved from
// trusted database state, never accepted as caller input — there is no
// request object anywhere in this file's own signature.
//
// SCOPE (5A.2K.1): CSV-classified batches, illegal-dumping domain only.
// XLS/XLSX are deterministically rejected (UNSUPPORTED_FORMAT) — never
// routed through any fallback. This file therefore has ZERO transitive
// dependency on xlsx/workbookParser.ts — see ../csvOnlyDecoder.ts's own
// header comment for why that boundary matters and how it's maintained
// independently of workbookParser.ts's own CSV branch.
//
// DECODE-BEFORE-TRANSACTION: storage GET, SHA-256 re-verification, CSV
// decode, and row mapping/validation ALL happen before any database
// transaction opens. The transaction itself contains ONLY the atomic
// worksheet claim (a single conditional UPDATE, never a separate
// SELECT-then-UPDATE) and the resulting domain writes — never Blob I/O,
// never parsing.
//
// NO DURABLE IMPORTING STATE: the schema's own uploads_canonical_status_check
// CHECK constraint structurally forbids any value outside
// AWAITING_CONFIRMATION | INELIGIBLE | SKIPPED | IMPORTED — there is no
// "IMPORTING" value this service could even write if it tried. The
// transaction itself is the sole claim boundary: if it rolls back, the
// worksheet remains AWAITING_CONFIRMATION; if it commits, the worksheet is
// IMPORTED atomically with its domain rows, in the same statement set.

// Empirically-derived (5A.2K.1-R) bounded timeout for the Step 8
// transaction, replacing Prisma's 5000ms default -- see the Step 8 comment
// below and the ADR for the measurement record. 30s gives >3x headroom
// over the worst of 3 real-Postgres runs at the documented 100,000-row
// ceiling (~8.5s max observed locally), while remaining a genuinely
// bounded (never unbounded/"infinite") ceiling appropriate for a still-
// dark, HTTP-route-free service.
const IMPORT_TRANSACTION_TIMEOUT_MS = 30_000;

export interface ConfirmWorksheetTrustedContext {
  /** Trusted, already-authenticated caller context — never re-derived here. */
  organisationId: string;
  worksheetUploadId: string;
}

export type ConfirmWorksheetOutcome =
  | { ok: true; alreadyImported: true; worksheetUploadId: string }
  | { ok: true; alreadyImported: false; worksheetUploadId: string; importedRows: number }
  | { ok: false; code: FailureCode; message: string };

function fail(code: FailureCode): ConfirmWorksheetOutcome {
  return { ok: false, code, message: getMessageTemplate(code) };
}

/**
 * Confirms and canonically imports one DATA_HUB worksheet's rows into the
 * illegal-dumping domain, CSV-classified batches only.
 *
 * Flow: tenant+lineage-scoped worksheet lookup -> AWAITING_CONFIRMATION
 * precondition -> tenant-scoped parent ImportBatch lookup (READY,
 * non-tombstoned, via the worksheet's own persisted import_batch_id, never
 * caller input) -> CSV-only format gate -> bounded RawFileStore.get() ->
 * mandatory SHA-256 re-verification against the batch's own persisted
 * sha256 -> CSV decode + illegal-dumping row mapping (all pre-transaction)
 * -> a single transaction performing the atomic conditional-UPDATE claim
 * plus the resulting domain writes -> IMPORTED, atomically, or a clean
 * "lost the claim" resolution.
 */
export async function confirmDataHubWorksheet(
  context: ConfirmWorksheetTrustedContext
): Promise<ConfirmWorksheetOutcome> {
  const { organisationId, worksheetUploadId } = context;

  // ---- Step 1 — tenant + DATA_HUB lineage-scoped worksheet lookup. id,
  // organisation_id, and lineage_kind are ALL part of the SAME predicate —
  // never fetch-by-id-then-check. Nonexistent, wrong-tenant, and
  // LEGACY-lineage all collapse to the identical WORKSHEET_NOT_FOUND
  // outcome, reusing read.ts's own established code/semantics verbatim. ----
  const worksheet = await prisma.upload.findFirst({
    where: { id: worksheetUploadId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
    select: { id: true, import_batch_id: true, worksheet_index: true, canonical_status: true },
  });
  if (!worksheet || worksheet.import_batch_id === null || worksheet.worksheet_index === null) {
    return fail("WORKSHEET_NOT_FOUND");
  }

  // ---- Step 2 — precondition. Only AWAITING_CONFIRMATION is eligible for
  // a first import attempt. IMPORTED is idempotent (a clean, distinct
  // success outcome, never an error). INELIGIBLE/SKIPPED/any other value
  // are rejected identically via WORKSHEET_NOT_ELIGIBLE — deliberately not
  // distinguished further, mirroring WORKSHEET_NOT_FOUND's own
  // non-existence-leaking discipline. ----
  if (worksheet.canonical_status === "IMPORTED") {
    return { ok: true, alreadyImported: true, worksheetUploadId };
  }
  if (worksheet.canonical_status !== "AWAITING_CONFIRMATION") {
    return fail("WORKSHEET_NOT_ELIGIBLE");
  }

  // ---- Step 3 — parent ImportBatch lookup, via the worksheet's OWN
  // persisted import_batch_id (never caller input), tenant-scoped via the
  // compound id_organisation_id key. Must be READY and non-tombstoned. ----
  const batch = await prisma.importBatch.findUnique({
    where: { id_organisation_id: { id: worksheet.import_batch_id, organisation_id: organisationId } },
    select: { status: true, content_type: true, sha256: true, storage_key: true, deleted_at: true },
  });
  if (!batch || batch.deleted_at !== null) {
    return fail("WORKSHEET_NOT_FOUND");
  }
  if (batch.status !== "READY") {
    return fail("BATCH_NOT_READY");
  }
  if (!batch.sha256) {
    return fail("PROVIDER_FAILURE");
  }

  // ---- Step 4 — CSV-only format gate. Deterministic, no fallback of any
  // kind for XLS/XLSX — this service never imports workbookParser.ts or
  // xlsx, so there is no code path that could even attempt to parse them. ----
  if (batch.content_type !== "csv") {
    return fail("UNSUPPORTED_FORMAT");
  }

  // ---- Step 5 — bounded storage retrieval, via the existing composition
  // root / buildImportBatchKey only — never a caller-provided path. ----
  const storage = createImportBatchStorage();
  const storageKey = buildImportBatchKey(organisationId, worksheet.import_batch_id);

  let getResult;
  try {
    getResult = await storage.get(storageKey, { maxBytes: MAX_SOURCE_FILE_BYTES });
  } catch (err) {
    if (err instanceof RawFileStoreError && err.code === "NOT_FOUND") {
      return fail("STORAGE_NOT_FOUND");
    }
    return fail("PROVIDER_FAILURE");
  }

  // ---- Step 6 — mandatory SHA-256 re-verification, unconditional, every
  // invocation, against the batch's own persisted sha256 column only. ----
  const computedSha256 = createHash("sha256").update(getResult.body).digest("hex");
  if (computedSha256 !== batch.sha256) {
    return fail("STORAGE_INTEGRITY_MISMATCH");
  }

  // ---- Step 7 — CSV decode + illegal-dumping row mapping, entirely
  // outside any transaction. Any failure here writes nothing and leaves
  // the worksheet exactly as it was (AWAITING_CONFIRMATION, retryable). ----
  let mappedRows;
  try {
    const { headers, rows } = decodeCsvOnly(getResult.body);
    mappedRows = mapIllegalDumpingRows(headers, rows);
  } catch (err) {
    if (err instanceof CsvOnlyDecodeError || err instanceof IllegalDumpingMappingError) {
      return fail("PARSER_REJECTED");
    }
    throw err;
  }

  // ---- Step 8 — the single transaction. First statement is the atomic
  // conditional claim (an UPDATE whose own WHERE clause encodes every
  // eligibility predicate — id, organisation_id, lineage_kind,
  // canonical_status — never a separate SELECT-then-UPDATE). If it affects
  // zero rows, a concurrent attempt (or an already-IMPORTED/changed row)
  // won the race; this attempt's own domain rows are never written, and
  // the transaction commits with no effect (a no-op UPDATE has nothing to
  // roll back). If it affects exactly one row, this attempt owns the
  // claim, and the domain writes proceed in the SAME transaction.
  //
  // EXPLICIT TRANSACTION TIMEOUT (5A.2K.1-R): Prisma's default interactive-
  // transaction timeout is 5000ms, which is well inside the documented
  // CSV_ONLY_LIMITS.maxSelectedWorksheetRows (100,000-row) accepted
  // workload — empirically measured to start failing (real Postgres,
  // disposable local container) between 45,000 and 60,000 rows, always by
  // 100,000. IMPORT_TRANSACTION_TIMEOUT_MS is set from real measurement at
  // the documented ceiling (100,000 rows: 3 runs, ~8.2-8.5s), not a guess —
  // see docs/architecture/decisions/0001-data-hub-ingestion-foundation.md
  // for the measurement record. maxWait (time to acquire/start the
  // transaction) is left at Prisma's default; only the execution timeout
  // is widened, since row count affects execution duration, not queueing. ----
  const result = await prisma.$transaction(async (tx) => {
    const claim = await tx.upload.updateMany({
      where: {
        id: worksheetUploadId,
        organisation_id: organisationId,
        lineage_kind: "DATA_HUB",
        canonical_status: "AWAITING_CONFIRMATION",
      },
      data: {
        canonical_status: "IMPORTED",
        attempt_count: { increment: 1 },
        last_attempt_at: new Date(),
      },
    });

    if (claim.count === 0) {
      // Lost the race, or the row changed between Step 1's read and this
      // transaction. Re-read the current state (still inside the same
      // transaction) to distinguish "someone else already imported it"
      // (idempotent success) from any other outcome.
      const current = await tx.upload.findUnique({
        where: { id: worksheetUploadId },
        select: { canonical_status: true },
      });
      return { claimed: false as const, currentStatus: current?.canonical_status ?? null };
    }

    await tx.illegalDumping.createMany({
      data: mappedRows.map((row) => ({
        organisation_id: organisationId,
        upload_id: worksheetUploadId,
        ...row,
      })),
    });

    return { claimed: true as const, importedRows: mappedRows.length };
  }, { timeout: IMPORT_TRANSACTION_TIMEOUT_MS });

  if (!result.claimed) {
    if (result.currentStatus === "IMPORTED") {
      return { ok: true, alreadyImported: true, worksheetUploadId };
    }
    return fail("WORKSHEET_NOT_ELIGIBLE");
  }

  return { ok: true, alreadyImported: false, worksheetUploadId, importedRows: result.importedRows };
}
