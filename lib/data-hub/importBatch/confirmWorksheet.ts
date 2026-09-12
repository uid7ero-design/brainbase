import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { buildImportBatchKey, RawFileStoreError } from "../storage/rawFileStore";
import { createImportBatchStorage } from "./compositionRoot";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import { decodeCsvOnly, CsvOnlyDecodeError } from "../csvOnlyDecoder";
import {
  mapIllegalDumpingRows,
  IllegalDumpingMappingError,
  type MappedIllegalDumpingRecord,
} from "./illegalDumpingMapper";
import { computeCanonicalHash, findDuplicateSourceExternalId } from "./reconciliation";
import { getMessageTemplate, type FailureCode } from "./failureTaxonomy";
import { validateMappingDocument, type MappingDocument } from "../sourceMapping/mappingDocument";
import { compileMapping, applyCompiledMappingToRows, toIllegalDumpingMapperInput } from "../sourceMapping/mappingExecution";

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
// worksheetUploadId, confirmedBy} — nothing else. Storage locator,
// ImportBatch identity, worksheet name, lineage, and canonical_status are
// ALL resolved from trusted database state, never accepted as caller
// input — there is no request object anywhere in this file's own
// signature. confirmedBy (5A.2L) is durably persisted, but only ever
// derived by a future route from authenticated session identity, exactly
// like organisationId — never accepted as request body/query/header
// input by that route either.
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
// 5B.4D — FROZEN MAPPING CONFIRM INTEGRATION: when the worksheet carries a
// persisted Upload.mapping_version_id (frozen by 5B.4B's selection
// service), Confirm now consumes the SAME exact frozen MappingVersion
// lineage that 5B.4C Preview consumes — same resolution rule (exact id,
// tenant-scoped, no active-pointer/latest fallback, cross-source check,
// stored-document revalidation), same 5B.3 mappingExecution reuse, applied
// to the FULL worksheet dataset (never Preview's bounded 20-row sample).
// A legacy worksheet (mapping_version_id IS NULL) takes the completely
// unchanged pre-5B.4D path below — see Step 1/4.5/7/8's own comments for
// exactly where the two paths diverge and reconverge.
//
// VERSION-BOUND ATOMIC CLAIM (the merge-critical invariant): the exact
// frozen mapping_version_id is captured ONCE, immediately after Step 1's
// read, into expectedMappingVersionId — never re-read. For a mapped
// worksheet, that SAME captured value is both (a) the lookup key for every
// resolution/compile/apply step below, outside the transaction, and (b) an
// additional predicate on the Step 8 atomic claim's own WHERE clause. If a
// legitimate 5B.4B reselection changes Upload.mapping_version_id between
// this read and the claim, the claim's WHERE clause no longer matches the
// real row (mapping_version_id disagrees), the claim affects zero rows,
// and the existing lost-race resolution (re-read canonical_status) already
// falls through to WORKSHEET_NOT_ELIGIBLE — no new failure code, no stale
// domain write, no automatic retry against the new version.
//
// NO DURABLE IMPORTING STATE: the schema's own uploads_canonical_status_check
// CHECK constraint structurally forbids any value outside
// AWAITING_CONFIRMATION | INELIGIBLE | SKIPPED | IMPORTED — there is no
// "IMPORTING" value this service could even write if it tried. The
// transaction itself is the sole claim boundary: if it rolls back, the
// worksheet remains AWAITING_CONFIRMATION; if it commits, the worksheet is
// IMPORTED atomically with its domain rows, in the same statement set.
//
// 6.0C1 (SUPERSEDED BY 6.1B) — TEMPORARY FIRST-IMPORT / REPEAT-IMPORT
// FAIL-CLOSED GUARD. Until reconciliation existed, at most ONE distinct
// worksheet could successfully commit IllegalDumping domain rows per
// organisation + non-null SourceSystem — a coarse SourceSystem-wide
// EXISTS check inside Step 8, before the claim, that unconditionally
// blocked every worksheet after the first. That coarse check is REMOVED
// as of 6.1B: per-record reconciliation (see the 6.1B block below) now
// provides the real, permanent protection this guard was always a
// temporary stand-in for — a second (or Nth) worksheet from the same
// SourceSystem is now EXPECTED and CORRECT, with each of its records
// individually classified NEW/UNCHANGED/CHANGED, rather than rejected
// outright. Step 3.5's own NULL-source fail-closed gate (below) is
// UNCHANGED — reconciliation identity still cannot be authoritative
// without SourceSystem lineage, exactly as before.
//
// 6.1B — PER-RECORD RECONCILIATION (supersedes 6.0C1's coarse guard):
// inside the SAME Step 8 transaction, immediately AFTER the existing
// atomic worksheet claim succeeds (not before it — a confirmation that
// loses the claim must reach zero reconciliation/domain mutations), each
// mapped record is independently reconciled against its own
// SourceRecordIdentity (organisation_id + source_system_id + domain_kind
// 'ILLEGAL_DUMPING' + source_external_id):
//   - Case A (identity newly created this transaction, no prior
//     observation can exist): outcome NEW. A fresh IllegalDumping row is
//     created, linked via source_record_identity_id.
//   - Case B (identity pre-existed, at least one prior observation
//     exists): outcome UNCHANGED (canonical hash matches the latest
//     prior observation) or CHANGED (hash differs — the existing
//     IllegalDumping row is updated in place via source_record_identity_id,
//     using ONLY the source-controlled field allowlist — see
//     reconciliation.ts's own CANONICAL_HASH_FIELDS, which is also that
//     allowlist).
//   - Case C (identity pre-existed but has ZERO prior observations — an
//     inconsistent, should-be-unreachable state given full transactional
//     atomicity): FAILS CLOSED with RECONCILIATION_HISTORY_INCONSISTENT,
//     rolling back the entire transaction including the claim. Never
//     classified NEW, never a fabricated comparison hash, never inferred
//     from a unique-constraint failure.
// Identity resolution uses a plain Prisma `create` attempt, catching a
// P2002 unique-constraint violation to distinguish "just created" (Case
// A) from "already existed" (Case B/C, resolved via a follow-up
// `findUniqueOrThrow` on the same compound key) — functionally
// equivalent to, and relying on the identical database-level
// concurrency guarantee as, an `INSERT ... ON CONFLICT DO NOTHING
// RETURNING id` (the schema's own unique constraint on
// (organisation_id, source_system_id, domain_kind, source_external_id)
// is the actual concurrency backstop either way), while letting Prisma
// generate the identity's id client-side exactly like every other model
// in this codebase, rather than hand-rolling a raw-SQL id generator.
// Duplicate source_external_id values WITHIN one worksheet are rejected
// pre-transaction (Step 7.5, see confirmWorksheet.ts's own
// DUPLICATE_SOURCE_EXTERNAL_ID_IN_WORKSHEET check) — by the time this
// per-record loop runs, every source_external_id in mappedRecords is
// already guaranteed unique, so this loop never needs to handle two
// DIFFERENT rows in the SAME worksheet resolving to the same identity.
// The SourceSystem row lock acquired in step (a) below remains the sole
// serialization point for CROSS-worksheet concurrency (two different,
// concurrent confirmations for the same organisation+SourceSystem+
// source_external_id) — the second transaction's own identity-create
// attempt cannot even begin until the first transaction commits or rolls
// back, so it always observes the first's committed identity/observation
// state (or the schema's unique constraint rejects a residual race,
// never silently).

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
  /**
   * Data Hub 5A.2L — the authenticated confirming actor's own user id
   * (e.g. session.userId). Trusted, caller-resolved-from-session ONLY —
   * this function never derives it itself and never accepts it from
   * request input; a future route wrapping this service MUST source it
   * exclusively from requireRole()'s own resolved session, exactly like
   * organisationId above.
   */
  confirmedBy: string;
}

export type ConfirmWorksheetOutcome =
  | { ok: true; alreadyImported: true; worksheetUploadId: string }
  | {
      ok: true;
      alreadyImported: false;
      worksheetUploadId: string;
      // importedRows preserves its pre-6.1B meaning ("every row this
      // worksheet successfully processed") — under the new reconciliation
      // model that is exactly newRows + unchangedRows + changedRows, since
      // every mapped row is classified into exactly one of the three.
      importedRows: number;
      newRows: number;
      unchangedRows: number;
      changedRows: number;
    }
  | { ok: false; code: FailureCode; message: string };

function fail(code: FailureCode): ConfirmWorksheetOutcome {
  return { ok: false, code, message: getMessageTemplate(code) };
}

// 6.1B — thrown ONLY for Case C (a SourceRecordIdentity exists with zero
// prior observations, an inconsistent state that full transactional
// atomicity should make unreachable in normal operation). Caught
// specifically around the $transaction call below and converted into a
// clean RECONCILIATION_HISTORY_INCONSISTENT outcome — never left to
// propagate as an unexpected/uncaught error, and never confused with a
// genuinely unexpected failure (e.g. a real constraint violation), which
// still propagates uncaught exactly as before.
class ReconciliationHistoryInconsistentError extends Error {}

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
  const { organisationId, worksheetUploadId, confirmedBy } = context;

  // ---- Step 1 — tenant + DATA_HUB lineage-scoped worksheet lookup. id,
  // organisation_id, and lineage_kind are ALL part of the SAME predicate —
  // never fetch-by-id-then-check. Nonexistent, wrong-tenant, and
  // LEGACY-lineage all collapse to the identical WORKSHEET_NOT_FOUND
  // outcome, reusing read.ts's own established code/semantics verbatim. ----
  const worksheet = await prisma.upload.findFirst({
    where: { id: worksheetUploadId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
    select: { id: true, import_batch_id: true, worksheet_index: true, canonical_status: true, mapping_version_id: true },
  });
  if (!worksheet || worksheet.import_batch_id === null || worksheet.worksheet_index === null) {
    return fail("WORKSHEET_NOT_FOUND");
  }
  // Captured into a plain local so its non-null narrowing survives being
  // read from inside the Step 8 transaction closure below (property
  // narrowing on `worksheet.import_batch_id` itself does not persist
  // across a nested closure boundary).
  const importBatchId = worksheet.import_batch_id;

  // 5B.4D — captured ONCE, here, immediately after this read. Every later
  // mapped-path lookup/compile/apply step AND the Step 8 atomic claim's own
  // WHERE clause use this SAME value — never a second, later re-read of
  // Upload.mapping_version_id. This is what structurally binds the domain
  // write to the exact version that was validated outside the transaction
  // (see the VERSION-BOUND ATOMIC CLAIM header comment above).
  const expectedMappingVersionId = worksheet.mapping_version_id;

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
    select: { status: true, content_type: true, sha256: true, storage_key: true, deleted_at: true, source_system_id: true },
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

  // ---- Step 3.5 — 6.0C1 SOURCE SYSTEM REQUIREMENT. A worksheet whose
  // parent batch has no SourceSystem lineage fails closed here, before any
  // storage/decode/mapping work — the temporary repeat-import guard below
  // cannot be authoritative without a SourceSystem to scope/lock by. This
  // is Illegal-Dumping-Confirm-specific; the legacy/optional-source
  // initiation path itself remains fully unchanged and supported for every
  // other purpose. ----
  if (batch.source_system_id === null) {
    return fail("SOURCE_LINEAGE_REQUIRED");
  }
  const sourceSystemId = batch.source_system_id;

  // ---- Step 4 — CSV-only format gate. Deterministic, no fallback of any
  // kind for XLS/XLSX — this service never imports workbookParser.ts or
  // xlsx, so there is no code path that could even attempt to parse them. ----
  if (batch.content_type !== "csv") {
    return fail("UNSUPPORTED_FORMAT");
  }

  // ---- Step 4.5 — 5B.4D FROZEN MAPPING LINEAGE RESOLUTION. Reached only
  // when expectedMappingVersionId !== null — a legacy worksheet skips this
  // block entirely and takes the completely unchanged legacy path below.
  // This is an EXACT structural mirror of previewWorksheet.ts's own Step
  // 4.5 (same lookups, same tenant scoping, same no-active-pointer/no-
  // latest-fallback rule, same cross-source check, same stored-document
  // revalidation) — deliberately placed BEFORE storage access, mirroring
  // the existing TENANT-BEFORE-STORAGE discipline of Steps 1-4: an
  // unresolvable/corrupt frozen lineage is a gate failure, not a content
  // problem, so it must never cause a storage read. ----
  let resolvedMapping: { document: MappingDocument } | null = null;

  if (expectedMappingVersionId !== null) {
    // Fetch EXACTLY the frozen version, tenant-scoped. Deliberately no
    // `active` filter — deactivation of the parent SourceMapping/
    // SourceSystem after this version was frozen must never break
    // consumption of already-frozen lineage (5B.4B's own established rule:
    // `active` is a NEW-selection gate, never a consumption gate — 5B.4C
    // Preview already relies on this identical rule).
    const mappingVersion = await prisma.mappingVersion.findUnique({
      where: { id_organisation_id: { id: expectedMappingVersionId, organisation_id: organisationId } },
      select: { source_mapping_id: true, mapping_document: true },
    });
    if (!mappingVersion) {
      return fail("MAPPING_LINEAGE_UNAVAILABLE");
    }

    // Cross-source corruption check — the frozen version's own
    // SourceMapping.source_system_id must equal the batch's own
    // authoritative source_system_id. Tenant-scoped; also no `active`
    // filter (same consumption-vs-selection distinction as above).
    const sourceMapping = await prisma.sourceMapping.findUnique({
      where: { id_organisation_id: { id: mappingVersion.source_mapping_id, organisation_id: organisationId } },
      select: { source_system_id: true },
    });
    if (!sourceMapping || sourceMapping.source_system_id !== batch.source_system_id) {
      return fail("MAPPING_LINEAGE_UNAVAILABLE");
    }

    // Revalidate the stored document EVERY call — never trust it merely
    // because it passed 5B.2's validator at creation time.
    const validated = validateMappingDocument(mappingVersion.mapping_document);
    if (!validated.ok) {
      return fail("MAPPING_DOCUMENT_INVALID");
    }

    resolvedMapping = { document: validated.document };
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
  // the worksheet exactly as it was (AWAITING_CONFIRMATION, retryable).
  //
  // 5B.4D — for a LEGACY worksheet (resolvedMapping === null) this is the
  // completely unchanged existing behavior: decodeCsvOnly + the fixed-
  // header mapIllegalDumpingRows directly. For a MAPPED worksheet, the
  // real, FULL (never Preview's bounded 20-row sample — Section 8's hard
  // requirement) decoded rows are compiled/applied through 5B.3's
  // unmodified mappingExecution.ts, then fed through the SAME, completely
  // unmodified illegal-dumping domain mapper via the same narrow reshape
  // adapter previewWorksheet.ts's own Step 7.5 already uses — mapping
  // stays structural-only (Section 9), domain interpretation (dates,
  // status, required-value rules) remains exclusively that mapper's own
  // responsibility, never re-implemented here. ----
  let mappedRecords: MappedIllegalDumpingRecord[];
  try {
    const { headers, rows } = decodeCsvOnly(getResult.body);

    if (resolvedMapping === null) {
      mappedRecords = mapIllegalDumpingRows(headers, rows);
    } else {
      // Compile against the REAL, FULL worksheet headers — reuses 5B.3's
      // unmodified compileMapping verbatim. compileMapping failure here is
      // a distinct, Confirm-only hard failure: Preview tolerates this
      // (structurallyValid: false, still a 200), but Confirm cannot import
      // a dataset it cannot fully, structurally map.
      const compiled = compileMapping(resolvedMapping.document, headers);
      if (!compiled.ok) {
        return fail("MAPPING_COMPILE_FAILED");
      }
      // Apply to the FULL row set — never a bounded sample.
      const canonicalRows = applyCompiledMappingToRows(compiled.plan, rows);
      const { headers: domainHeaders, rows: domainRows } = toIllegalDumpingMapperInput(canonicalRows);
      mappedRecords = mapIllegalDumpingRows(domainHeaders, domainRows);
    }
  } catch (err) {
    if (err instanceof CsvOnlyDecodeError || err instanceof IllegalDumpingMappingError) {
      return fail("PARSER_REJECTED");
    }
    throw err;
  }

  // ---- Step 7.5 — 6.1B: duplicate source_external_id rejection. Two rows
  // sharing an identical reconciliation identity within the SAME incoming
  // worksheet belong to the same source snapshot, never a longitudinal
  // NEW/UNCHANGED/CHANGED sequence — allowing this would let input row
  // order decide the final canonical IllegalDumping state and would create
  // two historical observations for one source snapshot. Pure, synchronous,
  // still entirely pre-transaction: zero writes on this path. ----
  const duplicateSourceExternalId = findDuplicateSourceExternalId(mappedRecords.map((m) => m.sourceExternalId));
  if (duplicateSourceExternalId !== null) {
    return fail("DUPLICATE_SOURCE_EXTERNAL_ID_IN_WORKSHEET");
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
  const DOMAIN_KIND = "ILLEGAL_DUMPING";

  type Step8Result =
    | { claimed: false; blocked: "SOURCE_SYSTEM_UNAVAILABLE" }
    | { claimed: false; currentStatus: string | null }
    | { claimed: true; newRows: number; unchangedRows: number; changedRows: number };

  let result: Step8Result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // (a) — unchanged verbatim: lock the exact, trusted, tenant-scoped
      // SourceSystem row. Both interpolated values are trusted (session-
      // derived organisationId; sourceSystemId read from this worksheet's
      // own persisted ImportBatch row in Step 3) — Prisma.sql parameterizes
      // them as real query parameters, never string-concatenated into the
      // SQL text. Now the sole serialization point for cross-worksheet
      // reconciliation concurrency (see the 6.1B header comment above).
      const lockedSourceSystem = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM source_systems
        WHERE id = ${sourceSystemId} AND organisation_id = ${organisationId}
        FOR UPDATE
      `);
      if (lockedSourceSystem.length === 0) {
        // The batch's own persisted source_system_id no longer resolves to a
        // real, tenant-owned SourceSystem row — reuse the existing generic,
        // non-leaking code for "the specified source system is not
        // available."
        return { claimed: false as const, blocked: "SOURCE_SYSTEM_UNAVAILABLE" as const };
      }

      // (b) — 6.1B: the atomic conditional claim now runs immediately after
      // the lock, BEFORE any reconciliation mutation (moved up from its
      // pre-6.1B position after the now-removed coarse guard) — a
      // confirmation that loses this claim must reach zero reconciliation/
      // domain writes. Predicate/data shape is otherwise byte-for-byte
      // unchanged from before 6.1B.
      const claim = await tx.upload.updateMany({
        where: {
          id: worksheetUploadId,
          organisation_id: organisationId,
          lineage_kind: "DATA_HUB",
          canonical_status: "AWAITING_CONFIRMATION",
          // 5B.4D — VERSION-BOUND ATOMIC CLAIM (Section 11/14 hard
          // requirement). Present ONLY for a mapped worksheet
          // (expectedMappingVersionId !== null) — a legacy worksheet's WHERE
          // clause is byte-for-byte identical to the pre-5B.4D predicate
          // above, never gaining this key at all. For a mapped worksheet,
          // this is what binds the domain write about to happen in this same
          // transaction to the EXACT MappingVersion that was resolved,
          // revalidated, compiled, and applied outside the transaction — if
          // a legitimate 5B.4B reselection changed Upload.mapping_version_id
          // since Step 1's read, this predicate no longer matches the real
          // row, the claim affects zero rows, and the existing lost-race
          // resolution below (re-read canonical_status) already handles it
          // safely — no new branch needed.
          ...(expectedMappingVersionId !== null ? { mapping_version_id: expectedMappingVersionId } : {}),
        },
        data: {
          canonical_status: "IMPORTED",
          attempt_count: { increment: 1 },
          last_attempt_at: new Date(),
          // 5A.2L — set ONLY here, in the same atomic conditional UPDATE as
          // the claim itself. If claim.count === 0 (lost the race, or the
          // row wasn't actually eligible), this UPDATE affects zero rows and
          // these values are never written to any row — never a separate
          // statement, never set before the claim is known to have
          // succeeded.
          confirmed_by: confirmedBy,
          confirmed_at: new Date(),
        },
      });

      if (claim.count === 0) {
        // Lost the race, or the row changed between Step 1's read and this
        // transaction. Re-read the current state (still inside the same
        // transaction) to distinguish "someone else already imported it"
        // (idempotent success) from any other outcome. Zero reconciliation
        // code below this point is ever reached in this branch.
        const current = await tx.upload.findUnique({
          where: { id: worksheetUploadId },
          select: { canonical_status: true },
        });
        return { claimed: false as const, currentStatus: current?.canonical_status ?? null };
      }

      // (c) — 6.1B: per-record reconciliation, now that the claim is
      // secured. Duplicate source_external_id values within this worksheet
      // were already rejected pre-transaction (Step 7.5), so every
      // record's identity key below is unique within this loop.
      const newDomainRows: Array<
        MappedIllegalDumpingRecord["row"] & {
          organisation_id: string;
          upload_id: string;
          source_record_identity_id: string;
        }
      > = [];
      let newRows = 0;
      let unchangedRows = 0;
      let changedRows = 0;

      for (const record of mappedRecords) {
        // Identity resolution: a plain create attempt, catching the
        // schema's own unique-constraint violation (P2002) to distinguish
        // "just created" (Case A) from "already existed" (Case B/C) — see
        // the 6.1B header comment above for why this is functionally
        // equivalent to INSERT ... ON CONFLICT DO NOTHING RETURNING id.
        let identityId: string;
        let isNewIdentity: boolean;
        try {
          const createdIdentity = await tx.sourceRecordIdentity.create({
            data: {
              organisation_id: organisationId,
              source_system_id: sourceSystemId,
              domain_kind: DOMAIN_KIND,
              source_external_id: record.sourceExternalId,
            },
            select: { id: true },
          });
          identityId = createdIdentity.id;
          isNewIdentity = true;
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            const existingIdentity = await tx.sourceRecordIdentity.findUniqueOrThrow({
              where: {
                organisation_id_source_system_id_domain_kind_source_external_id: {
                  organisation_id: organisationId,
                  source_system_id: sourceSystemId,
                  domain_kind: DOMAIN_KIND,
                  source_external_id: record.sourceExternalId,
                },
              },
              select: { id: true },
            });
            identityId = existingIdentity.id;
            isNewIdentity = false;
          } else {
            throw err;
          }
        }

        const canonicalHash = computeCanonicalHash(record.row);

        // Classification — the exact three-case rule (Phase 6.1B
        // architecture review, Decision/Correction 7): explicitly queries
        // for prior observation history rather than ever inferring it from
        // identity existence alone.
        let outcome: "NEW" | "UNCHANGED" | "CHANGED";
        if (isNewIdentity) {
          // Case A — no prior observation can exist for an identity this
          // transaction just created.
          outcome = "NEW";
        } else {
          const priorObservation = await tx.sourceRecordObservation.findFirst({
            where: { organisation_id: organisationId, source_record_identity_id: identityId },
            orderBy: { observed_at: "desc" },
            select: { canonical_hash: true },
          });
          if (!priorObservation) {
            // Case C — an inconsistent reconciliation state (identity
            // pre-exists with zero observation history). Fail closed:
            // never classify NEW, never fabricate a comparison hash, never
            // infer this from a unique-constraint failure. Throwing here
            // rolls back the ENTIRE transaction, including the claim above.
            throw new ReconciliationHistoryInconsistentError();
          }
          // Case B.
          outcome = priorObservation.canonical_hash === canonicalHash ? "UNCHANGED" : "CHANGED";
        }

        // Reconciliation history — one immutable observation per record
        // per confirm, regardless of outcome. change_summary is
        // deliberately left unset/null for this slice (matching the
        // schema's own "nullable/deferred, no runtime path writes any
        // value in this slice" documentation) — a future slice may choose
        // to populate a bounded, non-PII description of what changed.
        await tx.sourceRecordObservation.create({
          data: {
            organisation_id: organisationId,
            source_record_identity_id: identityId,
            import_batch_id: importBatchId,
            upload_id: worksheetUploadId,
            mapping_version_id: expectedMappingVersionId,
            canonical_hash: canonicalHash,
            outcome,
          },
        });

        if (outcome === "NEW") {
          newDomainRows.push({
            ...record.row,
            organisation_id: organisationId,
            upload_id: worksheetUploadId,
            source_record_identity_id: identityId,
          });
          newRows++;
        } else if (outcome === "UNCHANGED") {
          // No IllegalDumping mutation — the existing row is already
          // current.
          unchangedRows++;
        } else {
          // CHANGED — update the existing IllegalDumping row found via
          // source_record_identity_id, using ONLY the source-controlled
          // allowlist (reconciliation.ts's own CANONICAL_HASH_FIELDS —
          // the same 12 fields the hash itself is computed over). Never a
          // blind spread of the mapped row; never touches id/
          // organisation_id/upload_id/source_record_identity_id/
          // created_at/metadata.
          await tx.illegalDumping.update({
            where: { source_record_identity_id: identityId },
            data: {
              report_date: record.row.report_date,
              location: record.row.location,
              suburb: record.row.suburb,
              zone: record.row.zone,
              waste_type: record.row.waste_type,
              volume_estimate: record.row.volume_estimate,
              severity: record.row.severity,
              status: record.row.status,
              crew_assigned: record.row.crew_assigned,
              resolution_date: record.row.resolution_date,
              cost_estimate: record.row.cost_estimate,
              notes: record.row.notes,
            },
          });
          changedRows++;
        }
      }

      if (newDomainRows.length > 0) {
        await tx.illegalDumping.createMany({ data: newDomainRows });
      }

      return { claimed: true as const, newRows, unchangedRows, changedRows };
    }, { timeout: IMPORT_TRANSACTION_TIMEOUT_MS });
  } catch (err) {
    if (err instanceof ReconciliationHistoryInconsistentError) {
      return fail("RECONCILIATION_HISTORY_INCONSISTENT");
    }
    throw err;
  }

  if (!result.claimed) {
    // The SourceSystem lock failed (SourceSystem row missing), or the
    // worksheet claim itself lost the race. Zero reconciliation code was
    // ever reached in either case.
    if ("blocked" in result) {
      return fail(result.blocked);
    }
    if (result.currentStatus === "IMPORTED") {
      return { ok: true, alreadyImported: true, worksheetUploadId };
    }
    return fail("WORKSHEET_NOT_ELIGIBLE");
  }

  return {
    ok: true,
    alreadyImported: false,
    worksheetUploadId,
    importedRows: result.newRows + result.unchangedRows + result.changedRows,
    newRows: result.newRows,
    unchangedRows: result.unchangedRows,
    changedRows: result.changedRows,
  };
}
