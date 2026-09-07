// Data Hub 5A.3B — browser orchestration client: wire-contract types.
//
// This file hand-mirrors the LITERAL JSON shapes returned by the six live
// Data Hub HTTP routes (app/api/data-hub/**), re-derived directly from
// those route files' own source at implementation time (main @
// bcfbbcaf3a90ab68f3b20580ddec4803a2cdba63) — never imported from the
// server-side service/type modules (lib/data-hub/importBatch/**), even as
// `import type`. This is a deliberate module-boundary decision, not an
// oversight: this package is meant to be bundled into a browser client, and
// keeping ZERO import edges (type-only or otherwise) into the server tree
// means a refactor of the server's internal types can never accidentally
// change what this file's types say the wire contract is — a mismatch must
// be caught by a human re-reading the route source (as this file's own
// header comments cite), not silently absorbed through a shared type. Any
// literal duplicated here (e.g. the WorkbookFormat union) must be
// re-verified against the route/service source if either side changes.
//
// UNCERTAINTY DISCIPLINE (governs every type below): every result type
// that can be produced by network I/O is a discriminated union with an
// explicit "kind"/"outcome" tag — never a shape with optional fields
// papering over genuinely distinct cases. A boolean field is never used to
// gate the presence of a sibling field where a real discriminated union is
// possible (see ConfirmIllegalDumpingSuccess below for the canonical
// example this mirrors from the server's own ConfirmWorksheetOutcome).

/** Mirrors lib/data-hub/fileSignatures.ts's WorkbookFormat — duplicated
 * deliberately (see module header). Only "csv" is a supported end-to-end
 * path for this phase's confirm step; "xls"/"xlsx" batches can still be
 * initiated/uploaded/finalized but will deterministically fail CSV-only
 * inspect/confirm with UNSUPPORTED_FORMAT. */
export type DataHubWorkbookFormat = "csv" | "xls" | "xlsx";

export type ImportBatchStatus = "AWAITING_UPLOAD" | "PROCESSING" | "READY" | "FAILED" | "DELETION_PENDING";

// ---------------------------------------------------------------------------
// Transport layer — every endpoint call returns one of these three shapes.
// This is the single place "uncertainty" is represented structurally: a
// caller can never accidentally treat a networkError as a domain failure,
// because it has no `body` field to (mis)read one out of.
// ---------------------------------------------------------------------------

/** An HTTP response was received and its body was valid JSON. `httpStatus`
 * is provided for logging/telemetry only — every route in this family puts
 * its true domain outcome in the BODY (see finalize's own outcome-in-body-
 * on-always-200 discipline), so orchestration logic must branch on `body`,
 * never on `httpStatus` alone. */
export interface TransportResponse<TBody> {
  kind: "response";
  httpStatus: number;
  body: TBody;
}

/** The request never produced an interpretable response: a thrown
 * `fetch()` rejection (offline, DNS failure, connection reset), an
 * explicit timeout this client enforced itself, or a caller-triggered
 * abort. This is NOT a failure verdict about the operation's domain
 * outcome — the request may have been fully processed server-side before
 * the response was lost. `reason` distinguishes an explicit timeout/abort
 * (which this client caused) from a genuine network-level failure (which
 * it merely observed). */
export interface TransportNetworkUncertain {
  kind: "networkUncertain";
  reason: "timeout" | "aborted" | "networkError";
  message: string;
  cause: unknown;
}

/** An HTTP response was received but its body could not be parsed as the
 * expected JSON shape (non-JSON body, or JSON missing the fields this
 * client's narrowing depends on). Deliberately distinct from
 * networkUncertain: the server DID respond, so this is evidence of a
 * contract mismatch, not a lost request — but it still must never be
 * silently coerced into a guessed success/failure. */
export interface TransportMalformed {
  kind: "malformed";
  httpStatus: number;
  rawBody: string;
  parseError: unknown;
}

export type TransportResult<TBody> = TransportResponse<TBody> | TransportNetworkUncertain | TransportMalformed;

// ---------------------------------------------------------------------------
// POST /api/data-hub/import-batches (initiate)
// Source: app/api/data-hub/import-batches/route.ts, POST handler.
// ---------------------------------------------------------------------------

export interface InitiateRequestInput {
  originalFilename: string;
  declaredSizeBytes: number;
  /** Trimmed+lowercased 64-hex-char sha256, or omit entirely. */
  expectedSha256?: string;
}

export interface InitiatedBatchDTO {
  id: string;
  status: ImportBatchStatus;
  originalFilename: string | null;
  contentType: DataHubWorkbookFormat;
  sizeBytes: number;
  expectedSha256: string | null;
  attemptCount: number;
  lastFailureCode: string | null;
}

/** Every ok:true initiate response is HTTP 200 (route's own documented
 * deviation from an aspirational 201/200 split — see that route's own
 * header comment). `uploadToken` is non-null EXACTLY when a fresh token
 * was minted; `configurationError: true` is a distinct SOFT-FAILURE shape
 * (batch durably created/replayed, but token minting failed for
 * configuration reasons) that a naive "ok:true means proceed to upload"
 * caller would mishandle — this union makes that shape impossible to
 * ignore. */
export type InitiateResponseBody =
  | { batch: InitiatedBatchDTO; uploadToken: string; configurationError: false }
  | { batch: InitiatedBatchDTO; uploadToken: null; configurationError: true }
  | { batch: InitiatedBatchDTO; uploadToken: null; configurationError: false }
  | { error: string };

export type InitiateResult = TransportResult<InitiateResponseBody>;

// ---------------------------------------------------------------------------
// POST /api/data-hub/import-batches/[id]/finalize
// Source: app/api/data-hub/import-batches/[id]/finalize/route.ts, POST.
//
// LOAD-BEARING: outcome is ALWAYS carried in the body on the two real
// domain results (READY/FAILED), both HTTP 200. Every other shape below
// (OWNERSHIP_LOST, and the bare `{error}` CLAIM_REJECTED shape covering
// NOT_FOUND/ALREADY_PROCESSING/ALREADY_READY/DELETION_PENDING/
// TERMINAL_FAILURE/UNEXPECTED_STATE) carries NO machine-readable reason
// code on the wire — classifyClaimFailure's `reason` field is server-side
// only and is never serialized into the HTTP response; every CLAIM_REJECTED
// case (regardless of reason) collapses to an identical `{error: string}`
// body, and ALREADY_PROCESSING/ALREADY_READY/DELETION_PENDING additionally
// share the exact same message text (all three route through the generic
// INVALID_STATE template). A client CANNOT distinguish "409 because this
// batch is already READY" from "409 because another attempt is mid-flight"
// from the finalize response alone — this is why finalizeUncertainty
// recovery (orchestrator.ts) always re-fetches batch detail rather than
// trying to parse a reason out of this body.
// ---------------------------------------------------------------------------

export type PersistedFailureCodeClient =
  | "STORAGE_NOT_FOUND"
  | "STORAGE_METADATA_MISMATCH"
  | "SIZE_LIMIT"
  | "ZERO_BYTE"
  | "HASH_MISMATCH"
  | "PREFLIGHT_REJECTED"
  | "PROVIDER_FAILURE"
  | "STALE_RECLAIMED";

export type FinalizeResponseBody =
  | { ok: true; outcome: "READY"; batchId: string; sha256: string }
  | {
      ok: true;
      outcome: "FAILED";
      batchId: string;
      failureCode: PersistedFailureCodeClient;
      failureMessage: string;
      retryable: boolean;
    }
  | { ok: false; error: string } // OWNERSHIP_LOST (409) — reason IS distinguishable (this shape is unique to it)
  | { error: string }; // CLAIM_REJECTED, any reason (404/409/500) — reason is NOT distinguishable on the wire

export type FinalizeResult = TransportResult<FinalizeResponseBody>;

// ---------------------------------------------------------------------------
// GET /api/data-hub/import-batches/[id]  (batch detail — used as the
// ground-truth reconciliation source for finalize uncertainty)
// Source: app/api/data-hub/import-batches/[id]/route.ts, GET.
// ---------------------------------------------------------------------------

export interface ImportBatchDetailDTOClient {
  id: string;
  status: ImportBatchStatus;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string; // ISO 8601 — Date is serialized to string over JSON
  updatedAt: string;
  sha256: string | null;
  uploadedBy: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastFailureCode: string | null;
  lastFailureMessage: string | null;
  lastFailureRetryable: boolean | null;
  deletedAt: string | null;
}

export type GetImportBatchResponseBody = { batch: ImportBatchDetailDTOClient } | { error: string };

export type GetImportBatchResult = TransportResult<GetImportBatchResponseBody>;

// ---------------------------------------------------------------------------
// POST /api/data-hub/import-batches/[id]/inspect
// Source: app/api/data-hub/import-batches/[id]/inspect/route.ts, POST.
//
// HONESTY CONSTRAINT (Section 21 / 5A.3B-PRE finding #8): this response
// carries STRUCTURAL metadata only — worksheetIndex/Name/Visibility/
// IsEmpty/canonicalStatus. It carries NO column headers, NO row preview,
// NO validation output, and (load-bearing for the next step) NO worksheet
// `id` — see WorksheetDescriptorClient's own comment. Never add a field
// here that isn't literally present in inspectCsvWorksheet.ts's own
// PersistedCsvWorksheetDescriptor.
// ---------------------------------------------------------------------------

export type CsvWorksheetCanonicalStatusClient = "AWAITING_CONFIRMATION" | "INELIGIBLE";

export interface WorksheetDescriptorClient {
  worksheetIndex: number;
  worksheetName: string;
  worksheetVisibility: "visible";
  worksheetIsEmpty: boolean;
  canonicalStatus: CsvWorksheetCanonicalStatusClient;
}

export type InspectFailureCodeClient =
  | "BATCH_NOT_FOUND"
  | "BATCH_NOT_READY"
  | "UNSUPPORTED_FORMAT"
  | "STORAGE_NOT_FOUND"
  | "PROVIDER_FAILURE"
  | "STORAGE_INTEGRITY_MISMATCH"
  | "PARSER_REJECTED"
  | "PERSISTENCE_CONFLICT";

export type InspectResponseBody =
  | { ok: true; worksheets: WorksheetDescriptorClient[] }
  | { ok: false; error: string; code?: InspectFailureCodeClient };

export type InspectResult = TransportResult<InspectResponseBody>;

// ---------------------------------------------------------------------------
// GET /api/data-hub/import-batches/[id]/worksheets  ("obtain worksheet" —
// the step that recovers the `id` inspect deliberately never returns)
// Source: app/api/data-hub/import-batches/[id]/worksheets/route.ts, GET.
// ---------------------------------------------------------------------------

export type WorksheetCanonicalStatusClient = "AWAITING_CONFIRMATION" | "INELIGIBLE" | "SKIPPED" | "IMPORTED";
export type WorksheetVisibilityClient = "visible" | "hidden" | "veryHidden";

export interface WorksheetSummaryDTOClient {
  id: string;
  worksheetIndex: number;
  worksheetName: string;
  worksheetVisibility: WorksheetVisibilityClient;
  worksheetIsEmpty: boolean;
  canonicalStatus: WorksheetCanonicalStatusClient;
  importBatchId: string;
  createdAt: string;
  updatedAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export type ListWorksheetsResponseBody = { worksheets: WorksheetSummaryDTOClient[] } | { error: string };

export type ListWorksheetsResult = TransportResult<ListWorksheetsResponseBody>;

// ---------------------------------------------------------------------------
// POST /api/data-hub/worksheets/[id]/confirm-illegal-dumping
// Source: app/api/data-hub/worksheets/[id]/confirm-illegal-dumping/route.ts.
//
// Two genuinely distinct success shapes, modeled as a real discriminated
// union (5A.3B-PRE finding #5) — never one shape with importedRows made
// optional.
// ---------------------------------------------------------------------------

export type ConfirmIllegalDumpingSuccess =
  | { ok: true; alreadyImported: true; worksheetUploadId: string }
  | { ok: true; alreadyImported: false; worksheetUploadId: string; importedRows: number };

export type ConfirmFailureCodeClient =
  | "WORKSHEET_NOT_FOUND"
  | "WORKSHEET_NOT_ELIGIBLE"
  | "BATCH_NOT_READY"
  | "UNSUPPORTED_FORMAT"
  | "STORAGE_NOT_FOUND"
  | "PROVIDER_FAILURE"
  | "STORAGE_INTEGRITY_MISMATCH"
  | "PARSER_REJECTED"
  | string; // the route's own statusByCode map is intentionally exhaustive against a much larger union of server-internal-only codes this client will never actually observe; kept open here rather than duplicating that entire defensive list.

export type ConfirmIllegalDumpingResponseBody = ConfirmIllegalDumpingSuccess | { ok: false; error: string; code?: ConfirmFailureCodeClient };

export type ConfirmIllegalDumpingResult = TransportResult<ConfirmIllegalDumpingResponseBody>;

// ---------------------------------------------------------------------------
// Upload progress (mirrors @vercel/blob/client's own UploadProgressEvent
// shape exactly — verified against the installed 2.8.0 package's own
// dist/create-folder-BM6BTlko.d.ts — so callers never need a translation
// layer between this module's progress events and the SDK's).
// ---------------------------------------------------------------------------

export interface DataHubUploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}
