import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { getMessageTemplate, type FailureCode } from "./failureTaxonomy";

// Data Hub 5A.2H.2 — dark, tenant-safe worksheet/ImportBatch read services
// (route-free, transport-independent).
//
// AUTH BOUNDARY: exactly the same discipline as initiate.ts/finalize.ts/
// inspectWorksheets.ts — every exported function accepts an already-
// resolved trusted context (organisationId, plus an id/cursor as needed)
// as plain parameters. It never attempts to resolve its own auth/session,
// and it deliberately never imports lib/org.ts's requireRole/
// requireSession: those depend on next/headers' cookies() and
// server-only, and physically cannot run outside a real Next.js request
// context. A FUTURE route wrapping this service (5A.2H.3) MUST derive
// organisationId from a real, authenticated session and MUST NOT accept
// it from arbitrary request input. There is NO runtime caller of any
// kind in this slice — see tests/containment/dataHubImportBatchDarkness.test.ts
// (updated) and tests/containment/worksheetReadService.test.ts for the
// static darkness proof.
//
// WHAT THIS SERVICE OWNS: four read-only operations —
// getImportBatch, listImportBatches, getWorksheet,
// listWorksheetsForBatch — over ImportBatch and DATA_HUB-lineage Upload
// rows already persisted by initiate.ts/finalize.ts/inspectWorksheets.ts.
// It NEVER writes to any row, NEVER touches physical storage (no
// RawFileStore, no compositionRoot, no Blob call of any kind), and NEVER
// parses a workbook (no workbookParser.ts import, no xlsx import,
// directly or transitively). Every query result is mapped through an
// explicit DTO — a raw Prisma model is never returned or spread — so
// storage internals (storage_key/etag/provider/deletion status) and
// every legacy-only Upload field (schema_type, module, legacy status,
// row_count, column_count, columns_detected, field_mappings,
// validation_errors, preview_rows, metadata, original_name, mimetype,
// size_bytes, and the DATA_HUB stored_path sentinel) can never leak
// through this module, by construction — see
// tests/containment/worksheetReadService.test.ts's DTO-shape containment
// proof.
//
// TENANT ISOLATION: every query restates organisation_id directly in its
// own `where` predicate — never solely through a nested relation filter.
// getImportBatch/getWorksheet/listWorksheetsForBatch's parent-existence
// check all use ImportBatch's own @@unique([id, organisation_id]) compound
// key (the same `id_organisation_id` lookup inspectWorksheets.ts already
// uses), so a wrong-tenant batch and a genuinely nonexistent batch id
// produce the identical BATCH_NOT_FOUND result — never distinguishable.
//
// LINEAGE ISOLATION: every worksheet-shaped query asserts
// lineage_kind = 'DATA_HUB' explicitly, never inferred merely from
// import_batch_id being non-null. A LEGACY-lineage Upload id, a
// nonexistent id, and a wrong-tenant id all collapse to the identical
// WORKSHEET_NOT_FOUND result via getWorksheet — never a distinguishable
// LINEAGE_MISMATCH code (deliberately not introduced — see
// failureTaxonomy.ts's own header comment on this phase's additions).
//
// TOMBSTONE POLICY: getImportBatch/listImportBatches exclude any batch
// with deleted_at IS NOT NULL (treated identically to BATCH_NOT_FOUND —
// no separate TOMBSTONED code). listWorksheetsForBatch's parent-existence
// gate is the same check, so a tombstoned parent also yields
// BATCH_NOT_FOUND rather than an (incorrectly) empty worksheet list.
// getWorksheet additionally re-checks its own worksheet row's parent
// batch tombstone status via a second, explicitly tenant-scoped
// ImportBatch lookup (never relying on Prisma's relation-nesting alone)
// — a DATA_HUB worksheet whose parent batch has been tombstoned is never
// exposed through getWorksheet, collapsing to WORKSHEET_NOT_FOUND like
// every other exclusion case.
//
// LIFECYCLE: batch reads are NOT restricted to READY — every
// non-tombstoned physical lifecycle state (AWAITING_UPLOAD, PROCESSING,
// READY, FAILED, DELETION_PENDING) is readable. listWorksheetsForBatch
// does not require READY either: a valid tenant-owned batch that has not
// yet had inspectWorksheets run against it simply returns an empty
// worksheets array, never an error. Worksheet metadata (visibility,
// isEmpty, canonicalStatus) is always returned truthfully, unfiltered —
// hidden/veryHidden/empty/INELIGIBLE rows are never silently dropped;
// any such filtering is a future caller's policy decision, not this
// dark domain layer's.
//
// CONSISTENCY: plain read-committed reads throughout. No transaction is
// used — none of the four operations combines multiple queries into an
// invariant that requires snapshot isolation (see the ADR's 5A.2H.2
// section for the full argument).

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export type ReadFailureCode = "BATCH_NOT_FOUND" | "WORKSHEET_NOT_FOUND" | "INVALID_CURSOR" | "INVALID_LIMIT";

export type WorksheetVisibility = "visible" | "hidden" | "veryHidden";

// The full set of currently-DB-valid canonical_status values (see
// uploads_canonical_status_check in scripts/create-import-batches.sql).
// inspectWorksheets.ts (5A.2H.1) only ever writes AWAITING_CONFIRMATION
// or INELIGIBLE today — SKIPPED/IMPORTED are reserved for a later,
// separate transition this phase does not perform — but this type models
// all four so a future writer of SKIPPED/IMPORTED requires no H.2 type
// change.
export type WorksheetCanonicalStatus = "AWAITING_CONFIRMATION" | "INELIGIBLE" | "SKIPPED" | "IMPORTED";

export interface ImportBatchSummaryDTO {
  id: string;
  status: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ImportBatchDetailDTO extends ImportBatchSummaryDTO {
  sha256: string | null;
  uploadedBy: string | null;
  attemptCount: number;
  lastAttemptAt: Date | null;
  lastFailureCode: string | null;
  lastFailureMessage: string | null;
  lastFailureRetryable: boolean | null;
  deletedAt: Date | null;
}

export interface WorksheetSummaryDTO {
  id: string;
  worksheetIndex: number;
  worksheetName: string;
  worksheetVisibility: WorksheetVisibility;
  worksheetIsEmpty: boolean;
  canonicalStatus: WorksheetCanonicalStatus;
  importBatchId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GetImportBatchTrustedContext {
  organisationId: string;
  importBatchId: string;
}

export interface ListImportBatchesTrustedContext {
  organisationId: string;
  /** Opaque cursor from a prior page's nextCursor. Omit for the first page. */
  cursor?: string;
  /** Defaults to DEFAULT_LIST_LIMIT; must be a positive integer <= MAX_LIST_LIMIT. */
  limit?: number;
}

export interface GetWorksheetTrustedContext {
  organisationId: string;
  worksheetId: string;
}

export interface ListWorksheetsForBatchTrustedContext {
  organisationId: string;
  importBatchId: string;
}

export type GetImportBatchResult =
  | { ok: true; batch: ImportBatchDetailDTO }
  | { ok: false; code: "BATCH_NOT_FOUND"; message: string };

export type ListImportBatchesResult =
  | { ok: true; batches: ImportBatchSummaryDTO[]; hasNextPage: boolean; nextCursor: string | null }
  | { ok: false; code: "INVALID_CURSOR" | "INVALID_LIMIT"; message: string };

export type GetWorksheetResult =
  | { ok: true; worksheet: WorksheetSummaryDTO }
  | { ok: false; code: "WORKSHEET_NOT_FOUND"; message: string };

export type ListWorksheetsForBatchResult =
  | { ok: true; worksheets: WorksheetSummaryDTO[] }
  | { ok: false; code: "BATCH_NOT_FOUND"; message: string };

function fail<C extends ReadFailureCode>(code: C): { ok: false; code: C; message: string } {
  // getMessageTemplate accepts the broader FailureCode union; every
  // literal in ReadFailureCode is a member of it (see failureTaxonomy.ts).
  return { ok: false, code, message: getMessageTemplate(code as FailureCode) };
}

// ---------------------------------------------------------------------------
// DTO mapping — the only place a Prisma row's fields are read field-by-
// field into a new, explicit object. Never `...row`, never a raw model
// returned directly.
// ---------------------------------------------------------------------------

interface ImportBatchRow {
  id: string;
  status: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: Date;
  updated_at: Date;
}

function toSummaryDTO(row: ImportBatchRow): ImportBatchSummaryDTO {
  return {
    id: row.id,
    status: row.status,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ImportBatchDetailRow extends ImportBatchRow {
  sha256: string | null;
  uploaded_by: string | null;
  attempt_count: number;
  last_attempt_at: Date | null;
  last_failure_code: string | null;
  last_failure_message: string | null;
  last_failure_retryable: boolean | null;
  deleted_at: Date | null;
}

function toDetailDTO(row: ImportBatchDetailRow): ImportBatchDetailDTO {
  return {
    ...toSummaryDTO(row),
    sha256: row.sha256,
    uploadedBy: row.uploaded_by,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    lastFailureCode: row.last_failure_code,
    lastFailureMessage: row.last_failure_message,
    lastFailureRetryable: row.last_failure_retryable,
    deletedAt: row.deleted_at,
  };
}

interface WorksheetRow {
  id: string;
  worksheet_index: number | null;
  worksheet_name: string | null;
  worksheet_visibility: string | null;
  worksheet_is_empty: boolean | null;
  canonical_status: string | null;
  import_batch_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function toWorksheetDTO(row: WorksheetRow): WorksheetSummaryDTO {
  // Defensive invariant (mirrors inspectWorksheets.ts's own precedent,
  // Step 6/9 of that module): a row matched by lineage_kind = 'DATA_HUB'
  // is guaranteed by uploads_lineage_coherence_check to have every one of
  // these columns non-null. Structurally impossible to violate; not a
  // normal caller-facing case.
  if (
    row.worksheet_index === null ||
    row.worksheet_name === null ||
    row.worksheet_visibility === null ||
    row.worksheet_is_empty === null ||
    row.canonical_status === null ||
    row.import_batch_id === null
  ) {
    throw new Error(
      "read: invariant violated — a DATA_HUB-lineage Upload row had a null structural column."
    );
  }
  return {
    id: row.id,
    worksheetIndex: row.worksheet_index,
    worksheetName: row.worksheet_name,
    worksheetVisibility: row.worksheet_visibility as WorksheetVisibility,
    worksheetIsEmpty: row.worksheet_is_empty,
    canonicalStatus: row.canonical_status as WorksheetCanonicalStatus,
    importBatchId: row.import_batch_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const IMPORT_BATCH_DETAIL_SELECT = {
  id: true,
  status: true,
  original_filename: true,
  content_type: true,
  size_bytes: true,
  created_at: true,
  updated_at: true,
  sha256: true,
  uploaded_by: true,
  attempt_count: true,
  last_attempt_at: true,
  last_failure_code: true,
  last_failure_message: true,
  last_failure_retryable: true,
  deleted_at: true,
} satisfies Prisma.ImportBatchSelect;

const WORKSHEET_SELECT = {
  id: true,
  worksheet_index: true,
  worksheet_name: true,
  worksheet_visibility: true,
  worksheet_is_empty: true,
  canonical_status: true,
  import_batch_id: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.UploadSelect;

/**
 * Fetches one ImportBatch by tenant-scoped id. Wrong-tenant, nonexistent,
 * and tombstoned (deleted_at IS NOT NULL) batches are all indistinguishable
 * BATCH_NOT_FOUND results.
 */
export async function getImportBatch(context: GetImportBatchTrustedContext): Promise<GetImportBatchResult> {
  const { organisationId, importBatchId } = context;

  const batch = await prisma.importBatch.findUnique({
    where: { id_organisation_id: { id: importBatchId, organisation_id: organisationId } },
    select: IMPORT_BATCH_DETAIL_SELECT,
  });
  if (!batch || batch.deleted_at !== null) {
    return fail("BATCH_NOT_FOUND");
  }
  return { ok: true, batch: toDetailDTO(batch) };
}

// ---------------------------------------------------------------------------
// Keyset pagination cursor — encodes ONLY the (created_at, id) ordering
// tuple. Never authoritative for organisation identity: organisation_id
// always comes from the trusted context parameter and is reasserted in
// the WHERE clause on every call, regardless of what a cursor decodes to.
// A forged-but-well-formed cursor can therefore only reposition a caller
// within their OWN already-tenant-scoped result set — it can never permit
// cross-tenant enumeration.
// ---------------------------------------------------------------------------

interface CursorTuple {
  createdAt: Date;
  id: string;
}

function encodeCursor(tuple: CursorTuple): string {
  return Buffer.from(JSON.stringify({ createdAt: tuple.createdAt.toISOString(), id: tuple.id }), "utf8").toString(
    "base64url"
  );
}

function decodeCursor(raw: string): CursorTuple | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const keys = Object.keys(parsed as Record<string, unknown>);
  if (keys.length !== 2 || !keys.includes("createdAt") || !keys.includes("id")) return null;
  const { createdAt, id } = parsed as { createdAt: unknown; id: unknown };
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof createdAt !== "string") return null;
  const parsedDate = new Date(createdAt);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return { createdAt: parsedDate, id };
}

function validateLimit(limit: number | undefined): number | null {
  const value = limit ?? DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(value) || value <= 0 || value > MAX_LIST_LIMIT) return null;
  return value;
}

/**
 * Lists ImportBatches for one tenant, newest first (created_at DESC,
 * id DESC tie-breaker), bounded and keyset-paginated. Excludes tombstoned
 * batches (deleted_at IS NOT NULL). Never performs a COUNT(*) — hasNextPage
 * is derived from fetching one extra row (limit + 1).
 *
 * PRECISION (5A.2H.2 remediation): import_batches.created_at is a
 * microsecond-precision TIMESTAMPTZ, but a JS Date — and therefore the
 * opaque cursor, which is built from one — can only ever represent
 * millisecond precision; there is no sub-millisecond component to lose or
 * keep. Ordering by the RAW column while comparing the WHERE-clause cursor
 * boundary against that same raw column mixes two different precisions:
 * two ImportBatch rows created for one organisation within the same
 * millisecond (a realistic condition under concurrent/rapid initiate()
 * calls) can then have a real row fall strictly between the cursor's
 * millisecond-truncated value and the next row's real value, silently and
 * permanently omitting it from the traversal. To keep the ORDER BY and the
 * WHERE-clause cursor comparison at IDENTICAL precision, both are computed
 * from date_trunc('milliseconds', created_at) — evaluated by Postgres
 * itself and selected AS created_at, so the value that becomes a JS Date
 * (for both the DTO's createdAt field and the next cursor) is already
 * exactly millisecond-valued, leaving nothing for any driver-level
 * rounding/truncation to disagree about on the next page's comparison.
 * Prisma's query builder cannot express a function/expression in
 * `orderBy`/`where` for a non-generated column, so this one operation uses
 * a narrowly-scoped `prisma.$queryRaw` built via `Prisma.sql` composition
 * — never `$queryRawUnsafe`, never string-built SQL. Every value
 * (organisationId, the cursor's truncated timestamp and id, and limit + 1)
 * is bound as a real, parameterized query argument, never interpolated as
 * SQL text; `deleted_at IS NULL` and every column/table identifier are
 * fixed literals written here, never caller-controlled. See
 * tests/containment/worksheetReadService.test.ts for the static safety
 * proof and scripts/tests/worksheetReadService.integration.test.ts's
 * dedicated sub-millisecond regression test for the real-Postgres proof.
 */
export async function listImportBatches(context: ListImportBatchesTrustedContext): Promise<ListImportBatchesResult> {
  const { organisationId, cursor, limit: rawLimit } = context;

  const limit = validateLimit(rawLimit);
  if (limit === null) {
    return fail("INVALID_LIMIT");
  }

  let cursorTuple: CursorTuple | null = null;
  if (cursor !== undefined) {
    cursorTuple = decodeCursor(cursor);
    if (!cursorTuple) {
      return fail("INVALID_CURSOR");
    }
  }

  // Both sides of this predicate deliberately use the SAME
  // date_trunc('milliseconds', created_at) expression the ORDER BY below
  // also uses — see the PRECISION note above. cursorTuple.createdAt is a
  // plain JS Date (millisecond-exact by construction), bound as a real
  // query parameter, never interpolated into the SQL text.
  const cursorFragment = cursorTuple
    ? Prisma.sql`AND (
        date_trunc('milliseconds', created_at) < ${cursorTuple.createdAt}
        OR (date_trunc('milliseconds', created_at) = ${cursorTuple.createdAt} AND id < ${cursorTuple.id})
      )`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<ImportBatchRow[]>(Prisma.sql`
    SELECT
      id,
      status,
      original_filename,
      content_type,
      size_bytes,
      date_trunc('milliseconds', created_at) AS created_at,
      updated_at
    FROM import_batches
    WHERE organisation_id = ${organisationId}
      AND deleted_at IS NULL
      ${cursorFragment}
    ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC
    LIMIT ${limit + 1}
  `);

  const hasNextPage = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = hasNextPage && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;

  return { ok: true, batches: page.map(toSummaryDTO), hasNextPage, nextCursor };
}

/**
 * Fetches one DATA_HUB-lineage worksheet (Upload row) by tenant-scoped id.
 * A single query predicates id + organisation_id + lineage_kind='DATA_HUB'
 * together (never fetched by id alone and permission-checked afterward).
 * Wrong-tenant, nonexistent, and LEGACY-lineage ids all collapse to the
 * identical WORKSHEET_NOT_FOUND result. A worksheet whose parent
 * ImportBatch is tombstoned is also excluded (WORKSHEET_NOT_FOUND) via a
 * second, explicitly tenant-scoped parent lookup.
 */
export async function getWorksheet(context: GetWorksheetTrustedContext): Promise<GetWorksheetResult> {
  const { organisationId, worksheetId } = context;

  const row = await prisma.upload.findFirst({
    where: { id: worksheetId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
    select: WORKSHEET_SELECT,
  });
  if (!row || row.import_batch_id === null) {
    return fail("WORKSHEET_NOT_FOUND");
  }

  const parent = await prisma.importBatch.findUnique({
    where: { id_organisation_id: { id: row.import_batch_id, organisation_id: organisationId } },
    select: { deleted_at: true },
  });
  if (!parent || parent.deleted_at !== null) {
    return fail("WORKSHEET_NOT_FOUND");
  }

  return { ok: true, worksheet: toWorksheetDTO(row) };
}

/**
 * Lists every DATA_HUB-lineage worksheet for one tenant-owned,
 * non-tombstoned ImportBatch, ordered strictly by worksheet_index ASC.
 * Requires the parent batch to exist for this tenant first (a missing or
 * tombstoned parent yields BATCH_NOT_FOUND, never a silently-empty list).
 * A valid parent batch with no persisted worksheets yet returns an empty
 * array successfully. Never requires the parent to be READY. No
 * pagination: lib/data-hub/workbookParser.ts's maxWorksheetCount already
 * bounds a single batch to at most 50 worksheets (re-verify this constant
 * has not materially changed before relying on it — this module does not
 * import workbookParser.ts and does not enforce the bound itself).
 */
export async function listWorksheetsForBatch(
  context: ListWorksheetsForBatchTrustedContext
): Promise<ListWorksheetsForBatchResult> {
  const { organisationId, importBatchId } = context;

  const batch = await prisma.importBatch.findUnique({
    where: { id_organisation_id: { id: importBatchId, organisation_id: organisationId } },
    select: { deleted_at: true },
  });
  if (!batch || batch.deleted_at !== null) {
    return fail("BATCH_NOT_FOUND");
  }

  const rows = await prisma.upload.findMany({
    where: { import_batch_id: importBatchId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
    orderBy: { worksheet_index: "asc" },
    select: WORKSHEET_SELECT,
  });

  return { ok: true, worksheets: rows.map(toWorksheetDTO) };
}
