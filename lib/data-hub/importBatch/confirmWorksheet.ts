import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { buildImportBatchKey, RawFileStoreError } from "../storage/rawFileStore";
import { createImportBatchStorage } from "./compositionRoot";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import { decodeCsvOnly, CsvOnlyDecodeError } from "../csvOnlyDecoder";
import { mapIllegalDumpingRows, IllegalDumpingMappingError, type MappedIllegalDumpingRow } from "./illegalDumpingMapper";
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
// 6.0C1 — TEMPORARY FIRST-IMPORT / REPEAT-IMPORT FAIL-CLOSED GUARD: until
// reconciliation exists, at most ONE distinct worksheet may successfully
// commit IllegalDumping domain rows per organisation + non-null
// SourceSystem. Two structural additions implement this:
//   (a) Step 3.5 — a worksheet whose parent ImportBatch has
//       source_system_id = NULL fails closed (SOURCE_LINEAGE_REQUIRED)
//       BEFORE any storage/decode/mapping work — the guard cannot be
//       authoritative without source lineage, and current initiate UI
//       still permits an optional/legacy null-source choice (a SEPARATE,
//       still-fully-supported path for every OTHER purpose — this gate is
//       Illegal-Dumping-Confirm-specific, never a global SourceSystem
//       requirement).
//   (b) Step 8 — inside the SAME transaction as the existing claim, BEFORE
//       it: an explicit `SELECT ... FOR UPDATE` lock on the batch's own
//       SourceSystem row (tenant-scoped, parameterized via Prisma.sql —
//       mirrors this codebase's own established event-capacity locking
//       precedent, e.g. app/api/public/events/.../checkout/route.ts),
//       THEN an EXISTS query against the illegal_dumping table itself
//       (joined through upload_id -> import_batch_id -> source_system_id)
//       — never Upload.canonical_status/lineage_kind, which are generic,
//       not Illegal-Dumping-specific. If a prior committed success is
//       found, this attempt fails SOURCE_ALREADY_IMPORTED before the
//       existing worksheet claim/domain write ever runs. The lock
//       serializes two concurrent first-import attempts for the same
//       organisation+SourceSystem — Postgres blocks the second
//       transaction's own FOR UPDATE request until the first commits or
//       rolls back, so the second transaction's EXISTS query always
//       observes the first's outcome.
// Guard identity is deliberately organisation_id + source_system_id ONLY —
// never mapping_version_id, sha256, filename, idempotency_key, ImportBatch
// id, or worksheet id (a different version/file/batch/worksheet for the
// SAME logical source must not create a second allowance). The guard never
// filters by SourceSystem/SourceMapping/MappingVersion `active` — historical
// success remains authoritative regardless of later deactivation, exactly
// matching 5B.4B/5B.4C/5B.4D's own established consumption-vs-selection
// rule. Same-worksheet idempotent replay is entirely unaffected — Step 2's
// existing IMPORTED short-circuit fires before this guard is ever reached.

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
  let mappedRows: MappedIllegalDumpingRow[];
  try {
    const { headers, rows } = decodeCsvOnly(getResult.body);

    if (resolvedMapping === null) {
      mappedRows = mapIllegalDumpingRows(headers, rows);
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
      mappedRows = mapIllegalDumpingRows(domainHeaders, domainRows);
    }
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
    // ---- 6.0C1 — FIRST-IMPORT / REPEAT-IMPORT GUARD (see header comment
    // for the full mechanism). Runs BEFORE the existing worksheet claim,
    // inside the SAME transaction, so a block here never reaches
    // createMany and never claims the worksheet. ----

    // (a) Lock the exact, trusted, tenant-scoped SourceSystem row. Both
    // interpolated values are trusted (session-derived organisationId;
    // sourceSystemId read from this worksheet's own persisted ImportBatch
    // row in Step 3) — Prisma.sql parameterizes them as real query
    // parameters, never string-concatenated into the SQL text.
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

    // (b) Existence check against the ILLEGAL_DUMPING domain table itself
    // (never Upload.canonical_status/lineage_kind, which are generic
    // worksheet-lineage concepts, not Illegal-Dumping-specific) — joined
    // through upload_id -> import_batch_id -> source_system_id. Both
    // organisation_id and source_system_id are the same trusted values
    // used for the lock above; never client-supplied. Deliberately no
    // `active`/deleted_at filter anywhere in this query — historical
    // success remains authoritative regardless of later SourceSystem/
    // SourceMapping/MappingVersion deactivation or ImportBatch tombstoning.
    const priorSuccess = await tx.$queryRaw<{ prior_success: boolean }[]>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM illegal_dumping d
        JOIN uploads u ON d.upload_id = u.id
        JOIN import_batches b ON u.import_batch_id = b.id
        WHERE d.organisation_id = ${organisationId}
          AND b.source_system_id = ${sourceSystemId}
      ) AS prior_success
    `);
    if (priorSuccess[0]?.prior_success) {
      return { claimed: false as const, blocked: "SOURCE_ALREADY_IMPORTED" as const };
    }

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
    // 6.0C1 — the guard (SourceSystem missing, or a prior success already
    // exists for this organisation+SourceSystem) fired before the existing
    // worksheet claim ever ran. Neither case ever reaches the existing
    // lost-race/currentStatus resolution below.
    if ("blocked" in result) {
      const blockedCode = result.blocked as "SOURCE_SYSTEM_UNAVAILABLE" | "SOURCE_ALREADY_IMPORTED";
      return fail(blockedCode);
    }
    if (result.currentStatus === "IMPORTED") {
      return { ok: true, alreadyImported: true, worksheetUploadId };
    }
    return fail("WORKSHEET_NOT_ELIGIBLE");
  }

  return { ok: true, alreadyImported: false, worksheetUploadId, importedRows: result.importedRows };
}
