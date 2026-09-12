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
  /** Data Hub 5B.5A — optional SourceSystem to attribute this batch to.
   * Omit entirely (never `null`/`""`) to take the exact pre-5B.4A legacy
   * path; see initiate.ts's own "sourceSystemId === null: EXACT
   * pre-5B.4A code path" comment on the server side. */
  sourceSystemId?: string;
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

// ---------------------------------------------------------------------------
// GET /api/data-hub/source-systems (Data Hub 5B.5A)
// Source: app/api/data-hub/source-systems/route.ts, GET handler, backed by
// lib/data-hub/sourceMapping/sourceSystems.ts's listSourceSystems (5B.2,
// unchanged) — manager+ read, organisationId session-derived only.
//
// Deliberately narrow: only the fields the SourceSystem-selection control
// actually renders (id/name/active) plus description, which the server DTO
// also carries at zero extra cost. No mapping-related field of any kind
// belongs here — this endpoint has none server-side either.
// ---------------------------------------------------------------------------

export interface SourceSystemDTOClient {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

export type ListSourceSystemsResponseBody =
  | { sourceSystems: SourceSystemDTOClient[]; hasNextPage: boolean; nextCursor: string | null }
  | { error: string };

export type ListSourceSystemsResult = TransportResult<ListSourceSystemsResponseBody>;

export type InitiateResult = TransportResult<InitiateResponseBody>;

// ---------------------------------------------------------------------------
// GET /api/data-hub/source-mappings (Data Hub 5B.5B)
// Source: app/api/data-hub/source-mappings/route.ts, GET handler, backed by
// lib/data-hub/sourceMapping/sourceMappings.ts's listSourceMappings (5B.2,
// unchanged) — manager+ read, organisationId session-derived only, filtered
// server-side by BOTH active=true and sourceSystemId (both real, existing
// query params — see that route's own "source_system_id is an OPTIONAL
// filter" comment).
//
// Deliberately narrow: id/sourceSystemId/name/active only. This type
// intentionally OMITS activeMappingVersionId, which the server DTO also
// carries — that field describes the SourceMapping's CURRENT global active
// version, never a specific worksheet's FROZEN version, and 5B.5B's whole
// UI-truthfulness invariant depends on this client never having a field
// that could be mistaken for (or misused as) a frozen version. The frozen
// version a worksheet actually consumes comes exclusively from the
// mapping-selection response or Preview's own mapping summary below —
// never from this list.
// ---------------------------------------------------------------------------

export interface SourceMappingDTOClient {
  id: string;
  sourceSystemId: string;
  name: string;
  active: boolean;
}

export type ListSourceMappingsResponseBody =
  | { sourceMappings: SourceMappingDTOClient[]; hasNextPage: boolean; nextCursor: string | null }
  | { error: string };

export type ListSourceMappingsResult = TransportResult<ListSourceMappingsResponseBody>;

// ---------------------------------------------------------------------------
// GET /api/data-hub/source-mappings/[id] (Data Hub 5B.5B)
// Source: app/api/data-hub/source-mappings/[id]/route.ts, GET handler.
//
// Used ONLY for the narrow "frozen mapping has since been deactivated, and
// is therefore absent from the active=true list above, but its human label
// must still be shown" case (spec Section 16) — a manager-readable lookup
// by the worksheet's own already-known, persisted sourceMappingId. Same
// deliberate field omission as SourceMappingDTOClient above.
// ---------------------------------------------------------------------------

export type GetSourceMappingResponseBody = { sourceMapping: SourceMappingDTOClient } | { error: string };

export type GetSourceMappingResult = TransportResult<GetSourceMappingResponseBody>;

// ---------------------------------------------------------------------------
// POST /api/data-hub/worksheets/[id]/mapping-selection (Data Hub 5B.4B,
// consumed by the UI for the first time in 5B.5B)
// Source: app/api/data-hub/worksheets/[id]/mapping-selection/route.ts.
//
// REQUEST ALLOWLIST (mirrors the route's own comment exactly): exactly one
// field, sourceMappingId. Never organisationId, sourceSystemId,
// mappingVersionId, versionNumber, or expectedMappingVersionId — the server
// resolves the active MappingVersion to freeze entirely server-side, at
// write time, from SourceMapping.active_mapping_version_id; the client
// supplies only WHICH mapping, never which version.
// ---------------------------------------------------------------------------

export interface MappingSelectionRequestInput {
  sourceMappingId: string;
}

export type MappingSelectionResponseBody =
  | { ok: true; worksheetUploadId: string; sourceMappingId: string; mappingVersionId: string; versionNumber: number }
  // Data Hub 5B.5B/Section 22: the route returns only `{ ok:false, error }`
  // on failure — no machine-readable `code` exists on this wire shape
  // (verified against the route's own source; unlike Preview/Confirm,
  // which do carry one). This client type deliberately does not invent one
  // — every failure (WORKSHEET_NOT_FOUND/WORKSHEET_NOT_ELIGIBLE/
  // SOURCE_LINEAGE_REQUIRED/SOURCE_MAPPING_UNAVAILABLE/INVALID_REQUEST) is
  // surfaced identically via this same generic, already manager-safe
  // `error` string.
  | { ok: false; error: string };

export type MappingSelectionResult = TransportResult<MappingSelectionResponseBody>;

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
  /** Data Hub 5B.5B — additive, mirrors read.ts's own
   * ImportBatchDetailDTO.sourceSystemId comment exactly: NULL for every
   * legacy/no-source batch, otherwise the exact SourceSystem chosen at
   * initiate time. This is the AUTHORITATIVE source for Review-stage
   * SourceMapping filtering after a reload/recovery — never re-derived
   * from stale client memory. */
  sourceSystemId: string | null;
}

export type GetImportBatchResponseBody = { batch: ImportBatchDetailDTOClient } | { error: string };

export type GetImportBatchResult = TransportResult<GetImportBatchResponseBody>;

// ---------------------------------------------------------------------------
// GET /api/data-hub/import-batches  (history list — Data Hub 5A.3D.2)
// Source: app/api/data-hub/import-batches/route.ts, GET handler, backed by
// lib/data-hub/importBatch/read.ts's listImportBatches (5A.2H.3, unchanged).
//
// Deliberately a NARROWER shape than ImportBatchDetailDTOClient above: no
// sha256, no uploadedBy, no failure detail — the summary DTO this route
// returns never carries those fields server-side (see read.ts's own
// ImportBatchSummaryDTO), so there is nothing to accidentally over-fetch or
// leak here even by omission-mistake. Detail (including failure info) is
// only ever fetched per-batch, on explicit open, via getImportBatch above —
// never for every history row (the N+1 hard rule).
// ---------------------------------------------------------------------------

export interface ImportBatchSummaryDTOClient {
  id: string;
  status: ImportBatchStatus;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export type ListImportBatchesResponseBody =
  | { batches: ImportBatchSummaryDTOClient[]; hasNextPage: boolean; nextCursor: string | null }
  | { error: string };

export type ListImportBatchesResult = TransportResult<ListImportBatchesResponseBody>;

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
  // Data Hub 5A.3D.0 — durable worksheet-level retry/failure history,
  // re-mirrored here from lib/data-hub/importBatch/read.ts's
  // WorksheetSummaryDTO (PR #154). NULL/0 for a worksheet that has never
  // had a mapping/validation failure recorded against it.
  lastAttemptAt: string | null;
  attemptCount: number;
  lastFailureCode: string | null;
  lastFailureMessage: string | null;
  lastFailureRetryable: boolean | null;
  // Data Hub 5A.3D.0 — authoritative, read-time count of domain rows this
  // worksheet produced. `null` means "not applicable" (canonicalStatus is
  // not IMPORTED); a genuine `0` is a real, truthful IMPORTED-with-zero-rows
  // result and must never be collapsed into `null` — see read.ts's own
  // attachImportedRowCounts comment.
  importedRowCount: number | null;
}

export type ListWorksheetsResponseBody = { worksheets: WorksheetSummaryDTOClient[] } | { error: string };

export type ListWorksheetsResult = TransportResult<ListWorksheetsResponseBody>;

// ---------------------------------------------------------------------------
// GET /api/data-hub/worksheets/[id]/preview
// Source: app/api/data-hub/worksheets/[id]/preview/route.ts, GET.
//
// Data Hub 5A.3C.0 — bounded, read-only content preview. Design authority:
// the completed 5A.3C.0 read-only discovery. Carries real server-derived
// worksheet content (headers, a bounded row sample) sufficient for a
// truthful "review your data" step — deliberately distinct from
// WorksheetDescriptorClient/WorksheetSummaryDTOClient above, neither of
// which carries any content. `sampleRows`/`headers` are always bounded
// (PREVIEW_MAX_SAMPLE_ROWS/COLUMNS/CELL_CHARS server-side, previewWorksheet.ts)
// regardless of the underlying file's legal maximum size — never the
// entire CSV. `requiredHeadersPresent`/`missingRequiredHeaders` is the
// ONLY Illegal-Dumping-specific interpretation this DTO carries; no
// per-row validation output exists here (deliberately deferred, matching
// the discovery's own scope boundary).
// ---------------------------------------------------------------------------

// Data Hub 5B.5B — hand-mirrors mappingExecution.ts's own
// CompileMappingDiagnostic union exactly (source of truth re-verified at
// implementation time). Safe, server-owned diagnostic codes only — never
// row/customer data.
export type CompileMappingDiagnosticClient =
  | { code: "MAPPING_REQUIRED_TARGET_MISSING"; canonicalTarget: string }
  | { code: "MAPPING_SOURCE_HEADER_MISSING"; canonicalTarget: string; sourceHeader: string }
  | { code: "MAPPING_SOURCE_HEADER_AMBIGUOUS"; canonicalTarget: string; sourceHeader: string; occurrences: number };

/** Bounded, canonical-field-keyed row — mirrors mappingExecution.ts's own
 * CanonicalRawRow (a Partial<Record<CanonicalFieldName, string>>). Kept as
 * an open string-keyed record here, deliberately not re-declaring the full
 * CanonicalFieldName literal union — this client renders these values
 * generically (a label/value list), never branches on which specific
 * canonical fields are present. */
export type CanonicalRawRowClient = Readonly<Record<string, string | undefined>>;

// Data Hub 5B.5B — mirrors previewWorksheet.ts's own WorksheetPreviewMappingSummary
// exactly (source re-verified at implementation time). Deliberately excludes
// the raw mapping_document and SourceMapping.active_mapping_version_id —
// this summary describes exactly the FROZEN version consumed for this one
// response, never "whatever is currently active". See Section 14's own
// truthfulness invariant: this is the ONLY place the client may read a
// worksheet's frozen version/label from — never SourceMappingDTOClient's
// (deliberately absent) activeMappingVersionId.
export interface WorksheetPreviewMappingSummaryClient {
  mappingVersionId: string;
  sourceMappingId: string;
  versionNumber: number;
  structurallyValid: boolean;
  mappingErrors: readonly CompileMappingDiagnosticClient[];
  mappedSampleRows: CanonicalRawRowClient[];
  domainRowsValid: boolean;
}

export interface WorksheetPreviewDTOClient {
  worksheetId: string;
  worksheetName: string;
  worksheetIndex: number;
  rowCount: number;
  columnCount: number;
  headers: string[];
  sampleRows: string[][];
  sampleRowCount: number;
  truncated: boolean;
  requiredHeadersPresent: boolean;
  missingRequiredHeaders: string[];
  /** Data Hub 5B.5B — null for a legacy worksheet (Upload.mapping_version_id
   * IS NULL), exactly mirroring the server DTO's own comment. Present only
   * when this worksheet has frozen mapping lineage. */
  mapping: WorksheetPreviewMappingSummaryClient | null;
}

export type PreviewFailureCodeClient =
  | "WORKSHEET_NOT_FOUND"
  | "WORKSHEET_NOT_ELIGIBLE"
  | "BATCH_NOT_READY"
  | "UNSUPPORTED_FORMAT"
  | "STORAGE_NOT_FOUND"
  | "PROVIDER_FAILURE"
  | "STORAGE_INTEGRITY_MISMATCH"
  | "PARSER_REJECTED"
  // Data Hub 5B.4C — frozen mapping lineage cannot be resolved (see
  // previewWorksheet.ts's own PreviewWorksheetFailureCode comment: covers
  // missing MappingVersion, foreign tenant, and cross-source corruption
  // alike, deliberately undistinguished). Added in 5B.5B — already returned
  // by the server since 5B.4C, previously absent from this client type.
  | "MAPPING_LINEAGE_UNAVAILABLE"
  // Data Hub 5B.4C — the frozen MappingVersion's own stored document fails
  // revalidation at use time.
  | "MAPPING_DOCUMENT_INVALID";

export type WorksheetPreviewResponseBody =
  | { ok: true; preview: WorksheetPreviewDTOClient }
  | { ok: false; error: string; code?: PreviewFailureCodeClient };

export type WorksheetPreviewResult = TransportResult<WorksheetPreviewResponseBody>;

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
  | "MAPPING_LINEAGE_UNAVAILABLE"
  | "MAPPING_DOCUMENT_INVALID"
  // Data Hub 5B.4D — Confirm-only (Preview tolerates a compile failure as
  // informational; Confirm cannot import an unmappable dataset). Added in
  // 5B.5B — already returned by the server since 5B.4D, previously absent
  // from this client type.
  | "MAPPING_COMPILE_FAILED"
  // Data Hub 6.1B — a worksheet with two rows sharing one reconciliation
  // identity (source_external_id) is rejected before any writes occur.
  | "DUPLICATE_SOURCE_EXTERNAL_ID_IN_WORKSHEET"
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
