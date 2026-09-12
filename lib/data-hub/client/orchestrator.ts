// Data Hub 5A.3B — headless browser orchestration for the canonical CSV
// Illegal Dumping import flow: initiate -> direct private Blob upload ->
// finalize -> inspect CSV -> obtain worksheet -> confirm Illegal Dumping ->
// imported. NO rendered UI (that is 5A.3C's job) — this file exposes a
// plain state machine any framework (React, Vue, vanilla) can drive.
//
// CORE DISCIPLINE (governs every branch in this file):
//   1. A successful physical upload is NOT a successful import — `phase`
//      never jumps straight from an upload outcome to "imported" without
//      passing through finalize/inspect/confirm's own authoritative
//      responses.
//   2. A network timeout/abort is NOT a failed import — see every
//      `networkUncertain`-shaped branch below, none of which ever sets
//      phase to a *Failed state on its own; they always route to a
//      reconciliation step that consults the server's own ground truth.
//   3. finalize's response is interpreted by its BODY's `outcome` field,
//      never by HTTP status alone (see runFinalize below).
//   4. An import is marked "imported"/"alreadyImported" ONLY from
//      confirmIllegalDumping's own authoritative response body — never
//      inferred from any earlier step's success.
//
// This module performs ZERO direct DB/Prisma access and ZERO import of any
// app/api/data-hub/** or lib/data-hub/importBatch/** file — every fact it
// knows about server-side contracts is re-derived into this package's own
// wire types (types.ts) and cited from source in this file's own comments.

import {
  confirmIllegalDumping as callConfirmIllegalDumping,
  fetchWorksheetPreview as callFetchWorksheetPreview,
  finalizeImportBatch as callFinalize,
  getImportBatch as callGetImportBatch,
  getSourceMapping as callGetSourceMapping,
  initiateImportBatch as callInitiate,
  inspectCsvWorksheet as callInspect,
  listImportBatches as callListImportBatches,
  listSourceMappings as callListSourceMappings,
  listSourceSystems as callListSourceSystems,
  listWorksheetsForBatch as callListWorksheets,
  selectWorksheetMapping as callSelectWorksheetMapping,
  type HttpClientConfig,
  type ListImportBatchesParams,
  type ListSourceMappingsParams,
  type ListSourceSystemsParams,
} from "./httpClient";
import { uploadFileDirectToBlob, resolveUploadPathname, type DirectUploadResult } from "./blobUpload";
import { generateIdempotencyKey } from "./fileHash";
import type {
  ConfirmFailureCodeClient,
  DataHubUploadProgress,
  ImportBatchDetailDTOClient,
  ImportBatchStatus,
  InitiatedBatchDTO,
  ListImportBatchesResult,
  ListSourceMappingsResult,
  ListSourceSystemsResult,
  PersistedFailureCodeClient,
  WorksheetPreviewDTOClient,
  WorksheetSummaryDTOClient,
} from "./types";

// ---------------------------------------------------------------------------
// Public state shape
// ---------------------------------------------------------------------------

export interface ImportBatchHandle {
  id: string;
  status: ImportBatchStatus;
  originalFilename: string | null;
  contentType: string;
  sizeBytes: number;
  /** Data Hub 5B.5B — the AUTHORITATIVE SourceSystem this batch is
   * attributed to, or null for a legacy/no-source batch. For a fresh
   * start() this is the in-session `currentSourceSystemId` captured at
   * Step 1 (the initiate response body itself never echoes it back — see
   * InitiatedBatchDTO); for a resumeFromBatchId() recovery it is read from
   * the persisted, authoritative ImportBatchDetailDTOClient.sourceSystemId
   * instead — never assumed to still match whatever this browser tab
   * happened to have in memory before the reload. */
  sourceSystemId: string | null;
}

function toHandle(batch: InitiatedBatchDTO, sourceSystemId: string | null): ImportBatchHandle {
  return {
    id: batch.id,
    status: batch.status,
    originalFilename: batch.originalFilename,
    contentType: batch.contentType,
    sizeBytes: batch.sizeBytes,
    sourceSystemId,
  };
}

export type DataHubImportState =
  | { phase: "idle" }
  | { phase: "initiating" }
  | { phase: "initiateFailed"; message: string }
  /** Soft-failure shape (5A.3B-PRE finding #2): the batch row exists and is
   * durably AWAITING_UPLOAD, but no upload token could be minted. Retrying
   * `retryInitiate()` (same idempotency key) is the only forward path —
   * this is never conflated with a normal failure. */
  | { phase: "initiateConfigurationError"; batch: ImportBatchHandle }
  | { phase: "awaitingUpload"; batch: ImportBatchHandle; uploadToken: string }
  | { phase: "uploading"; batch: ImportBatchHandle; uploadToken: string; progress: DataHubUploadProgress | null }
  /** The physical PUT was cancelled or lost its network connection. The
   * object's existence at the storage key is UNKNOWN (see the
   * ABORT-VS-COMPLETION RACE comment on abort() below) — this state
   * exposes `proceedToFinalize()` as the ONLY recommended recovery
   * (finalize's own storage.head() call is authoritative), not a direct
   * re-upload. */
  | { phase: "uploadUncertain"; batch: ImportBatchHandle; uploadToken: string; message: string }
  | { phase: "finalizing"; batch: ImportBatchHandle }
  /** finalize's own response was ambiguous (network issue, or one of the
   * indistinguishable CLAIM_REJECTED/OWNERSHIP_LOST shapes — see
   * types.ts's own FinalizeResponseBody comment) and ground-truth
   * reconciliation (GET batch detail) also could not resolve it, OR
   * reconciliation found the batch still PROCESSING (a genuinely
   * in-flight concurrent attempt). `retryFinalize()` re-runs the whole
   * attempt+reconcile cycle. */
  | { phase: "finalizeUncertain"; batch: ImportBatchHandle; message: string }
  | { phase: "reconciling"; batch: ImportBatchHandle }
  /** PHYSICAL finalization only — see finalize route's own header comment.
   * Does NOT mean parsed/validated/imported. */
  | { phase: "physicalReady"; batch: ImportBatchHandle; sha256: string }
  | {
      phase: "physicalFailed";
      batch: ImportBatchHandle;
      failureCode: PersistedFailureCodeClient | string;
      failureMessage: string;
      retryable: boolean;
    }
  /** The batch reached a state this flow cannot proceed from at all (e.g.
   * DELETION_PENDING) — discovered only via reconciliation. Terminal: no
   * retry action this module exposes can change it. */
  | { phase: "batchTerminal"; batch: ImportBatchHandle; message: string }
  | { phase: "inspecting"; batch: ImportBatchHandle }
  | { phase: "inspectFailed"; batch: ImportBatchHandle; code: string; message: string }
  | { phase: "obtainingWorksheet"; batch: ImportBatchHandle }
  | { phase: "obtainWorksheetFailed"; batch: ImportBatchHandle; message: string }
  /** Structural metadata only — worksheetIndex/Name/IsEmpty/canonicalStatus
   * plus the `id` this state's own predecessor step exists solely to
   * obtain. Deliberately named "confirmationReady", never "review-ready"
   * or anything implying content review: NO column headers, NO row
   * preview, NO validation output exist anywhere in this API surface today
   * (5A.3B-PRE finding #8) — a caller must never fabricate any such data
   * to backfill a "review" UI on top of this state. */
  | { phase: "confirmationReady"; batch: ImportBatchHandle; worksheet: WorksheetSummaryDTOClient }
  /** Data Hub 5A.3C.0 — OPTIONAL bounded-content-preview step, entered only
   * by an explicit `loadPreview()` call from "confirmationReady" (or a
   * retry from "previewFailed"/"previewReady"). "confirmationReady" itself
   * is UNCHANGED and remains reachable directly from "obtainingWorksheet"
   * exactly as before 5A.3C.0 — a caller that never wants a preview is
   * never forced through any of these three new phases. */
  | { phase: "previewing"; batch: ImportBatchHandle; worksheet: WorksheetSummaryDTOClient }
  | {
      phase: "previewFailed";
      batch: ImportBatchHandle;
      worksheet: WorksheetSummaryDTOClient;
      code: string;
      message: string;
    }
  /** Real server-derived worksheet content (bounded headers/sample rows) —
   * never fabricated, never inferred from confirmationReady's own
   * structural-only worksheet field. See types.ts's own
   * WorksheetPreviewDTOClient comment for exactly what this does and does
   * not contain. */
  | { phase: "previewReady"; batch: ImportBatchHandle; worksheet: WorksheetSummaryDTOClient; preview: WorksheetPreviewDTOClient }
  | { phase: "confirming"; batch: ImportBatchHandle; worksheet: WorksheetSummaryDTOClient }
  | {
      phase: "imported";
      batch: ImportBatchHandle;
      worksheetId: string;
      importedRows: number;
      // Data Hub 6.1B — additive, OPTIONAL: only the live confirm-response
      // path (confirmWorksheet below) supplies these; the resume/read
      // path (attachImportedRowCounts-derived, further below) does not
      // recompute a per-outcome breakdown and leaves them undefined
      // rather than fabricating one.
      newRows?: number;
      unchangedRows?: number;
      changedRows?: number;
    }
  | { phase: "alreadyImported"; batch: ImportBatchHandle; worksheetId: string }
  | {
      phase: "confirmFailed";
      batch: ImportBatchHandle;
      worksheet: WorksheetSummaryDTOClient;
      code: ConfirmFailureCodeClient | string;
      message: string;
    }
  /** Anything this module observed but cannot honestly classify into any
   * state above (a malformed response, an unexpected batch status, etc.)
   * — never silently coerced into a success or a specific failure code
   * this module did not actually see. */
  | { phase: "unknownError"; message: string; recoverable: boolean }
  /** Data Hub 5A.3D.1 — entered ONLY by an explicit `resumeFromBatchId()`
   * call (never automatically, never on construction). Transient: the
   * batch's server-authoritative status is being fetched and reconciled
   * into one of this union's EXISTING phases wherever a match exists (see
   * `resumeFromBatchId`'s own doc comment for the full recovery matrix). */
  | { phase: "resumingBatch"; batchId: string }
  /** Data Hub 5A.3D.1 — a RECOVERED worksheet whose canonicalStatus is
   * INELIGIBLE or SKIPPED: terminal and non-confirmable, hydrated
   * truthfully from a fresh server read. Deliberately distinct from
   * "confirmationReady" (which implies confirm() is a legitimate next
   * action) and from "batchTerminal" (which is batch-scoped, not
   * worksheet-scoped) — reusing either would misrepresent this state.
   * confirm() does not accept this phase; calling it throws, exactly like
   * every other phase confirm() does not recognize. */
  | { phase: "worksheetTerminal"; batch: ImportBatchHandle; worksheet: WorksheetSummaryDTOClient; reason: "INELIGIBLE" | "SKIPPED" };

export interface StartImportOptions {
  expectedSha256?: string;
  /** Reuse a specific idempotency key (e.g. resuming a session after a
   * page reload where the caller persisted the key alongside the batch
   * id). Defaults to a freshly generated one — see fileHash.ts's own
   * generateIdempotencyKey. */
  idempotencyKey?: string;
  /** Data Hub 5B.5A — the manager's optional SourceSystem choice, made on
   * the Select screen before this call. Omit entirely for the legacy/
   * no-source path — never pass an empty string or null. Threaded
   * verbatim into the initiate request body (see runInitiate below) and,
   * once start() has fired, is immutable for the lifetime of this batch:
   * there is no method on this class that can change it afterward. */
  sourceSystemId?: string;
}

export interface DataHubOrchestratorConfig extends HttpClientConfig {
  /** Injected for deterministic tests; defaults to fileHash.ts's real
   * generator. */
  generateIdempotencyKey?: () => string;
}

type Listener = (state: DataHubImportState) => void;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export class DataHubIllegalDumpingImportSession {
  private readonly config: DataHubOrchestratorConfig;
  private state: DataHubImportState = { phase: "idle" };
  private readonly listeners = new Set<Listener>();
  private idempotencyKey: string | null = null;
  private uploadAbortController: AbortController | null = null;
  private disposed = false;
  /** Data Hub 5A.3D.1 — monotonically-incrementing token guarding
   * `resumeFromBatchId()`'s own async continuations. Bumped at the start
   * of every `resumeFromBatchId()` call AND at the start of `start()` (a
   * fresh logical attempt supersedes any in-flight recovery, per Section
   * 18/19 of the governing spec). A continuation whose captured generation
   * no longer matches this field abandons silently (no setState) rather
   * than risk overwriting whatever newer operation superseded it — the
   * SAME safety goal `disposed` already serves for teardown, extended to
   * cover "superseded but not disposed". Never read or mutated by any
   * ordinary (non-resume) code path, so it has zero effect on `start()`'s
   * own observable behavior for a caller that never calls
   * `resumeFromBatchId()`. */
  private resumeGeneration = 0;

  constructor(config: DataHubOrchestratorConfig = {}) {
    this.config = config;
  }

  getState(): DataHubImportState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.uploadAbortController?.abort();
    this.listeners.clear();
  }

  private setState(next: DataHubImportState): void {
    if (this.disposed) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  private genKey(): string {
    return this.config.generateIdempotencyKey?.() ?? generateIdempotencyKey();
  }

  // -------------------------------------------------------------------
  // Step 1 — initiate
  // -------------------------------------------------------------------

  async start(file: File, options: StartImportOptions = {}): Promise<void> {
    // A fresh logical attempt always supersedes any in-flight
    // resumeFromBatchId() recovery — see resumeGeneration's own comment.
    // No effect on this method's own behavior otherwise.
    this.resumeGeneration++;
    this.idempotencyKey = options.idempotencyKey ?? this.genKey();
    this.currentFile = file;
    // Captured once, for the lifetime of this batch — see
    // StartImportOptions.sourceSystemId's own comment. retryInitiate()
    // below reuses this exact same field, never re-reads options.
    this.currentSourceSystemId = options.sourceSystemId;
    await this.runInitiate(file, options.expectedSha256);
  }

  /** Re-runs initiate with the SAME idempotency key — the correct recovery
   * both for `initiateFailed` (network/validation issue on the initiate
   * call itself) and for `initiateConfigurationError` (Step 14's soft
   * failure: the row exists AWAITING_UPLOAD, so a replay call mints a
   * fresh token per proceedAfterCreateOrReplay's own AWAITING_UPLOAD
   * branch — see initiate.ts). Never generates a new idempotency key: that
   * would create a genuinely NEW batch row rather than resuming this one. */
  async retryInitiate(expectedSha256?: string): Promise<void> {
    if (!this.currentFile || !this.idempotencyKey) {
      throw new Error("data-hub client: retryInitiate() called before start().");
    }
    await this.runInitiate(this.currentFile, expectedSha256);
  }

  private currentFile: File | null = null;
  /** Data Hub 5B.5A — set once in start(), reused unchanged by
   * retryInitiate(). undefined means "no source selected", which
   * JSON.stringify drops entirely from the initiate body below — the
   * exact byte-identical pre-5B.5A/pre-5B.4A request shape. Never set to
   * null or "" by any code path in this class. */
  private currentSourceSystemId: string | undefined = undefined;

  private async runInitiate(file: File, expectedSha256?: string): Promise<void> {
    this.setState({ phase: "initiating" });
    const idempotencyKey = this.idempotencyKey!;

    const result = await callInitiate(
      {
        originalFilename: file.name,
        declaredSizeBytes: file.size,
        expectedSha256,
        idempotencyKey,
        sourceSystemId: this.currentSourceSystemId,
      },
      this.config
    );

    if (result.kind !== "response") {
      this.setState({ phase: "initiateFailed", message: result.kind === "networkUncertain" ? result.message : "The server returned an unreadable response." });
      return;
    }
    const body = result.body;
    if ("error" in body) {
      this.setState({ phase: "initiateFailed", message: body.error });
      return;
    }

    const batch = toHandle(body.batch, this.currentSourceSystemId ?? null);

    // Soft-failure shape (5A.3B-PRE finding #2) — checked BEFORE the
    // uploadToken null-check below so it is never misreported as a plain
    // "no token" case. A naive `if (body.uploadToken) proceed` check would
    // still be correct here (both null-token branches skip upload), but
    // this explicit branch keeps the distinct DOMAIN MEANING of
    // configurationError (a config problem, retryable via re-initiate)
    // visible in the exposed state, rather than collapsing it into
    // whatever the "PROCESSING/READY replay, no new token needed" case
    // would otherwise look like.
    if (body.configurationError) {
      this.setState({ phase: "initiateConfigurationError", batch });
      return;
    }

    if (body.uploadToken === null) {
      // batch.status is PROCESSING/READY (a replay of an already-advanced
      // batch) or FAILED-non-replay-eligible. Either way there is no
      // upload to perform — jump straight to whatever this batch's own
      // authoritative state implies, via the same reconciliation path
      // finalize uncertainty uses, so this module has exactly ONE place
      // that turns an ImportBatchStatus into a DataHubImportState.
      await this.reconcileFromBatchStatus(batch, null);
      return;
    }

    this.setState({ phase: "awaitingUpload", batch, uploadToken: body.uploadToken });
  }

  // -------------------------------------------------------------------
  // Step 2 — direct upload
  // -------------------------------------------------------------------

  async upload(onProgress?: (p: DataHubUploadProgress) => void): Promise<void> {
    if (this.state.phase !== "awaitingUpload") {
      throw new Error(`data-hub client: upload() called from unexpected phase "${this.state.phase}".`);
    }
    const { batch, uploadToken } = this.state;

    this.uploadAbortController = new AbortController();
    this.setState({ phase: "uploading", batch, uploadToken, progress: null });

    let result: DirectUploadResult;
    try {
      result = await uploadFileDirectToBlob({
        file: this.currentFile!,
        uploadToken,
        abortSignal: this.uploadAbortController.signal,
        onUploadProgress: (progress) => {
          if (this.state.phase === "uploading") {
            this.setState({ ...this.state, progress });
          }
          onProgress?.(progress);
        },
      });
    } catch (err) {
      // uploadFileDirectToBlob() is documented to still THROW (not return a
      // DirectUploadFailure) for a malformed/corrupted upload token —
      // resolveUploadPathname() decodes the token before that function's own
      // try block, by deliberate design (see blobUpload.ts's own header
      // comment: a contract violation, not a runtime upload failure). That
      // throw must never strand this session at "uploading" forever. Whether
      // any bytes reached storage is genuinely unknown here — this is the
      // SAME uncertainty the abort race below already routes to
      // uploadUncertain, not a distinct case needing its own phase;
      // proceedToFinalize()'s storage.head() call remains the authoritative
      // arbiter either way.
      this.uploadAbortController = null;
      const message = err instanceof Error ? err.message : "The upload could not be started.";
      this.setState({ phase: "uploadUncertain", batch, uploadToken, message });
      return;
    }
    this.uploadAbortController = null;

    if (!result.ok) {
      // NEITHER "aborted" nor "uploadError" is treated as a failed import
      // here — both collapse to uploadUncertain, whose only exposed
      // recovery is proceedToFinalize() (see the ABORT-VS-COMPLETION RACE
      // comment on abort() below for why a direct re-upload is never
      // offered from this state).
      this.setState({ phase: "uploadUncertain", batch, uploadToken, message: result.message });
      return;
    }

    // Physical upload succeeded — NOT an import success (Core Discipline
    // #1). Auto-advance straight into finalize: no user judgment is needed
    // between "bytes landed" and "ask the server to finalize them".
    await this.runFinalize(batch);
  }

  /**
   * ABORT-VS-COMPLETION RACE (Section 17): calling abort() during
   * "uploading" races the AbortController's own abort signal against the
   * physical PUT's completion. Two outcomes are possible once the abort
   * fires:
   *   (a) the request is torn down before Vercel Blob's API ever committed
   *       the object — nothing exists at the storage key; OR
   *   (b) the object was already fully written server-side and the
   *       response was merely in flight back to the browser when the
   *       abort fired — the object DOES exist.
   * This module has no way to distinguish (a) from (b) from the abort
   * itself (`put()` rejects identically either way, since the abort acts
   * on the client-side request/response, not on the server's own
   * already-completed write). It therefore NEVER assumes either outcome:
   * upload() above always routes an aborted upload to `uploadUncertain`,
   * whose only recommended recovery is proceedToFinalize() — finalize's
   * own storage.head() call is the authoritative arbiter of whether the
   * object exists (STORAGE_NOT_FOUND -> FAILED, retryable -> a fresh
   * initiate() correctly mints a new upload token per
   * isUploadTokenReplayEligible("STORAGE_NOT_FOUND") === true; object
   * present -> normal READY/FAILED-by-content-preflight outcome). Calling
   * retryInitiate()/upload() again directly from this state without going
   * through finalize first risks an allowOverwrite:false conflict against
   * a physical object that outcome (b) actually already wrote.
   */
  abort(): void {
    this.uploadAbortController?.abort();
  }

  // -------------------------------------------------------------------
  // Step 3 — finalize (+ uncertainty reconciliation)
  // -------------------------------------------------------------------

  /** Explicit recovery entry point from `uploadUncertain` or
   * `finalizeUncertain` (or a retry from `physicalFailed` when
   * `retryable === true`). Always re-runs the FULL attempt+reconcile
   * cycle — never assumes any part of a prior attempt's outcome. */
  async proceedToFinalize(): Promise<void> {
    const batch = this.currentBatch();
    if (!batch) throw new Error("data-hub client: proceedToFinalize() called with no active batch.");
    await this.runFinalize(batch);
  }

  async retryFinalize(): Promise<void> {
    await this.proceedToFinalize();
  }

  private async runFinalize(batch: ImportBatchHandle): Promise<void> {
    this.setState({ phase: "finalizing", batch });

    const result = await callFinalize(batch.id, this.config);

    // Core Discipline #3 — branch on the BODY's `outcome`, never on
    // httpStatus alone. Both READY and FAILED are ALWAYS HTTP 200 per the
    // route's own contract-freeze comment; this code does not even inspect
    // result.httpStatus to decide correctness, only to decide "is this
    // response interpretable at all" (the `kind !== "response"` check).
    if (result.kind === "response") {
      const body = result.body;
      if ("outcome" in body && body.outcome === "READY") {
        this.setState({ phase: "physicalReady", batch, sha256: body.sha256 });
        await this.runInspect(batch);
        return;
      }
      if ("outcome" in body && body.outcome === "FAILED") {
        this.setState({
          phase: "physicalFailed",
          batch,
          failureCode: body.failureCode,
          failureMessage: body.failureMessage,
          retryable: body.retryable,
        });
        return;
      }
      // Every remaining shape (OWNERSHIP_LOST's {ok:false,error}, or the
      // bare {error} CLAIM_REJECTED shape covering NOT_FOUND/
      // ALREADY_PROCESSING/ALREADY_READY/DELETION_PENDING/TERMINAL_FAILURE/
      // UNEXPECTED_STATE — see types.ts's own FinalizeResponseBody comment)
      // carries NO machine-readable reason on the wire. This is exactly
      // the case that requires reconciliation, never a guess.
      await this.reconcileFinalize(batch, "The finalize request could not be interpreted directly; confirming the batch's actual state.");
      return;
    }

    // networkUncertain or malformed — genuinely unknown whether the server
    // ever processed this finalize call. Core Discipline #2: never treated
    // as a failure here.
    const message =
      result.kind === "networkUncertain"
        ? result.message
        : "The finalize response could not be parsed.";
    await this.reconcileFinalize(batch, message);
  }

  /**
   * Section 19 — the single most safety-critical recovery path in this
   * module. Re-fetches the batch's own authoritative status via GET
   * /api/data-hub/import-batches/[id] (read.ts's getImportBatch) and maps
   * it directly to a DataHubImportState — this is the ONLY way this module
   * ever resolves an ambiguous finalize outcome, and it is used
   * UNCONDITIONALLY for every ambiguous shape (never only for a "409"
   * case): READY here is treated as success (this correctly turns a repeat
   * finalize's 409/ALREADY_READY response into a SUCCESS state, per
   * 5A.3B-PRE finding #4, WITHOUT ever having to parse a reason out of the
   * 409 body that the wire format does not actually carry — see
   * runFinalize's own comment on why that parsing is impossible).
   */
  private async reconcileFinalize(batch: ImportBatchHandle, uncertaintyMessage: string): Promise<void> {
    this.setState({ phase: "reconciling", batch });

    const result = await callGetImportBatch(batch.id, this.config);
    if (result.kind !== "response" || !("batch" in result.body)) {
      // The reconciliation read ITSELF was uncertain (or the batch is now
      // reported not found, which for a batch this module just tried to
      // finalize is itself surprising) — still never guessed. Exposes
      // retryFinalize() so the caller can try the whole cycle again.
      this.setState({ phase: "finalizeUncertain", batch, message: uncertaintyMessage });
      return;
    }

    await this.reconcileFromBatchStatus(batch, result.body.batch.status, result.body.batch);
  }

  /**
   * The single place an ImportBatchStatus (from ANY source — initiate's
   * replay branch, or finalize-uncertainty reconciliation) is turned into
   * a DataHubImportState. `detail` is populated only when the caller has a
   * full ImportBatchDetailDTO (the reconciliation path); initiate's own
   * replay branch only knows the coarse status, which is enough to route
   * every case except FAILED's own failureCode/message/retryable trio (see
   * the FAILED branch below).
   */
  private async reconcileFromBatchStatus(
    batch: ImportBatchHandle,
    status: ImportBatchStatus | null,
    detail?: { sha256: string | null; lastFailureCode: string | null; lastFailureMessage: string | null; lastFailureRetryable: boolean | null }
  ): Promise<void> {
    const resolvedStatus = status ?? batch.status;
    // Always thread the NEWLY LEARNED status into the handle exposed on the
    // resulting state — a stale `batch.status` (e.g. still "AWAITING_UPLOAD"
    // from the initiate response that started this whole flow) must never
    // leak into a state that just authoritatively learned the batch is
    // actually READY/FAILED/etc. via reconciliation.
    const batchWithStatus: ImportBatchHandle = { ...batch, status: resolvedStatus };
    switch (resolvedStatus) {
      case "READY": {
        const sha256 = detail?.sha256 ?? null;
        if (sha256 === null) {
          // Contradicts finalize.ts's own invariant (sha256 is set in the
          // SAME statement that sets status='READY' — see
          // completeReadyForFinalize). Never fabricated; surfaced honestly.
          this.setState({ phase: "unknownError", message: "Batch reports READY but no sha256 was returned.", recoverable: false });
          return;
        }
        this.setState({ phase: "physicalReady", batch: batchWithStatus, sha256 });
        await this.runInspect(batchWithStatus);
        return;
      }
      case "FAILED": {
        this.setState({
          phase: "physicalFailed",
          batch: batchWithStatus,
          failureCode: detail?.lastFailureCode ?? "PROVIDER_FAILURE",
          failureMessage: detail?.lastFailureMessage ?? "The import batch failed for an unspecified reason.",
          retryable: detail?.lastFailureRetryable ?? false,
        });
        return;
      }
      case "PROCESSING":
        // Genuinely in-flight (another attempt, possibly a still-running
        // duplicate of this very call). Never treated as success or
        // failure — the caller should wait and retryFinalize() again
        // later to re-check.
        this.setState({ phase: "finalizeUncertain", batch: batchWithStatus, message: "The batch is currently being finalized by another in-flight attempt." });
        return;
      case "AWAITING_UPLOAD":
        // The claim was never taken (e.g. initiate's own PROCESSING/READY
        // replay branch found neither — should be unreachable from that
        // caller, but IS reachable from finalize-uncertainty
        // reconciliation if the finalize call never actually reached the
        // server at all). Safe to retry finalize directly.
        this.setState({ phase: "finalizeUncertain", batch: batchWithStatus, message: "The batch has not yet been finalized. It is safe to retry." });
        return;
      case "DELETION_PENDING":
        this.setState({ phase: "batchTerminal", batch: batchWithStatus, message: "This import batch is pending deletion and cannot be finalized." });
        return;
      default: {
        // Exhaustiveness guard — ImportBatchStatus has no other member as
        // of this contract; a value reaching here means the wire contract
        // drifted since this file was last verified against source.
        const _exhaustive: never = resolvedStatus;
        this.setState({ phase: "unknownError", message: `Unrecognized batch status: ${String(_exhaustive)}`, recoverable: false });
      }
    }
  }

  private currentBatch(): ImportBatchHandle | null {
    const s = this.state;
    if ("batch" in s) return s.batch;
    return null;
  }

  // -------------------------------------------------------------------
  // Step 4 — inspect CSV
  // -------------------------------------------------------------------

  async retryInspect(): Promise<void> {
    const batch = this.currentBatch();
    if (!batch) throw new Error("data-hub client: retryInspect() called with no active batch.");
    await this.runInspect(batch);
  }

  private async runInspect(batch: ImportBatchHandle): Promise<void> {
    this.setState({ phase: "inspecting", batch });

    const result = await callInspect(batch.id, this.config);
    if (result.kind !== "response") {
      this.setState({ phase: "inspectFailed", batch, code: "NETWORK", message: result.kind === "networkUncertain" ? result.message : "The inspect response could not be parsed." });
      return;
    }
    const body = result.body;
    if (!body.ok) {
      this.setState({ phase: "inspectFailed", batch, code: body.code ?? "UNKNOWN", message: body.error });
      return;
    }

    // Step 5 — "obtain worksheet". inspect's own response deliberately
    // carries no `id` (5A.3B-PRE finding #8 / types.ts's own
    // WorksheetDescriptorClient comment) — a second call is required to
    // recover it. Never skipped, never fabricated.
    await this.runObtainWorksheet(batch);
  }

  // -------------------------------------------------------------------
  // Step 5 — obtain worksheet (the id inspect never returns)
  // -------------------------------------------------------------------

  async retryObtainWorksheet(): Promise<void> {
    const batch = this.currentBatch();
    if (!batch) throw new Error("data-hub client: retryObtainWorksheet() called with no active batch.");
    await this.runObtainWorksheet(batch);
  }

  private async runObtainWorksheet(batch: ImportBatchHandle): Promise<void> {
    this.setState({ phase: "obtainingWorksheet", batch });

    const result = await callListWorksheets(batch.id, this.config);
    if (result.kind === "networkUncertain") {
      this.setState({ phase: "obtainWorksheetFailed", batch, message: result.message });
      return;
    }
    if (result.kind === "malformed") {
      this.setState({ phase: "obtainWorksheetFailed", batch, message: "The worksheets list response could not be parsed." });
      return;
    }
    if (!("worksheets" in result.body)) {
      this.setState({ phase: "obtainWorksheetFailed", batch, message: result.body.error });
      return;
    }

    const worksheets = result.body.worksheets;
    // A CSV-classified batch always yields exactly one worksheet
    // (worksheetIndex 0) per inspectCsvWorksheet.ts's own CSV_WORKSHEET_INDEX
    // constant — this module treats any other count as an honest,
    // unrecoverable-by-retry surprise rather than silently picking one.
    if (worksheets.length !== 1) {
      this.setState({
        phase: "obtainWorksheetFailed",
        batch,
        message: `Expected exactly one CSV worksheet, found ${worksheets.length}.`,
      });
      return;
    }

    this.setState({ phase: "confirmationReady", batch, worksheet: worksheets[0] });
  }

  // -------------------------------------------------------------------
  // Step 5.5 — Data Hub 5A.3C.0: OPTIONAL bounded content preview.
  // Never auto-entered — "confirmationReady" is reached exactly as it was
  // before 5A.3C.0 (Step 5 above is completely unmodified), and confirm()
  // remains directly callable from "confirmationReady" with no preview
  // step in between. A caller invokes loadPreview() only if it wants to
  // show real worksheet content before confirming.
  // -------------------------------------------------------------------

  async loadPreview(): Promise<void> {
    if (
      this.state.phase !== "confirmationReady" &&
      this.state.phase !== "previewFailed" &&
      this.state.phase !== "previewReady"
    ) {
      throw new Error(`data-hub client: loadPreview() called from unexpected phase "${this.state.phase}".`);
    }
    const { batch, worksheet } = this.state;
    await this.runLoadPreview(batch, worksheet);
  }

  /** Re-issues the SAME preview GET — safe to call any number of times;
   * previewWorksheet.ts is a pure read with no side effects, so a repeat
   * call after a prior failure (network, transient storage issue, etc.)
   * carries no risk of double-anything. */
  async retryPreview(): Promise<void> {
    if (this.state.phase !== "previewFailed") {
      throw new Error(`data-hub client: retryPreview() called from unexpected phase "${this.state.phase}".`);
    }
    await this.loadPreview();
  }

  // -------------------------------------------------------------------
  // Step 5.6 — Data Hub 5B.5B: explicit SourceMapping selection/
  // reselection. The server (selectWorksheetMapping.ts, 5B.4B) remains the
  // SOLE authority for which exact MappingVersion gets frozen — this
  // method sends only `sourceMappingId`, never a version. On success, it
  // deliberately does NOT return the frozen version as this call's own
  // "current truth" for a caller to hold onto: it re-runs `loadPreview()`
  // immediately, so the single, ongoing source of truth for "what is
  // currently frozen" stays previewReady.preview.mapping — never a second,
  // independently-drifting piece of state (spec Section 12/19/28). The
  // { ok:true, ... } fields returned here are for IMMEDIATE, one-shot
  // caller feedback only (e.g. a toast), not for driving persistent
  // display.
  // -------------------------------------------------------------------

  async selectMapping(
    sourceMappingId: string
  ): Promise<
    | { ok: true; sourceMappingId: string; mappingVersionId: string; versionNumber: number }
    | { ok: false; error: string }
  > {
    if (
      this.state.phase !== "confirmationReady" &&
      this.state.phase !== "previewing" &&
      this.state.phase !== "previewFailed" &&
      this.state.phase !== "previewReady"
    ) {
      throw new Error(`data-hub client: selectMapping() called from unexpected phase "${this.state.phase}".`);
    }
    const { batch, worksheet } = this.state;

    const result = await callSelectWorksheetMapping(worksheet.id, { sourceMappingId }, this.config);
    if (result.kind !== "response") {
      return {
        ok: false,
        error: result.kind === "networkUncertain" ? result.message : "The mapping selection response could not be parsed.",
      };
    }
    const body = result.body;
    if (!body.ok) {
      return { ok: false, error: body.error };
    }

    // Success — discard any stale Preview rendered from the OLD frozen
    // mapping (spec Section 19: "no automatic version change without the
    // selection POST" cuts both ways — once the POST DID succeed, the
    // display must move forward, never linger on stale data). Re-uses the
    // SAME batch/worksheet this call started with; if a concurrent
    // operation has since disposed this session, runLoadPreview's own
    // setState() no-ops safely (existing `disposed` guard).
    await this.runLoadPreview(batch, worksheet);

    return {
      ok: true,
      sourceMappingId: body.sourceMappingId,
      mappingVersionId: body.mappingVersionId,
      versionNumber: body.versionNumber,
    };
  }

  private async runLoadPreview(batch: ImportBatchHandle, worksheet: WorksheetSummaryDTOClient): Promise<void> {
    this.setState({ phase: "previewing", batch, worksheet });

    const result = await callFetchWorksheetPreview(worksheet.id, this.config);
    if (result.kind !== "response") {
      this.setState({
        phase: "previewFailed",
        batch,
        worksheet,
        code: "NETWORK",
        message: result.kind === "networkUncertain" ? result.message : "The preview response could not be parsed.",
      });
      return;
    }

    const body = result.body;
    if (!("ok" in body) || !body.ok) {
      this.setState({
        phase: "previewFailed",
        batch,
        worksheet,
        code: "error" in body ? (body.code ?? "UNKNOWN") : "UNKNOWN",
        message: "error" in body ? body.error : "The preview failed for an unknown reason.",
      });
      return;
    }

    this.setState({ phase: "previewReady", batch, worksheet, preview: body.preview });
  }

  // -------------------------------------------------------------------
  // Step 6 — confirm Illegal Dumping (the ONLY step that may ever set
  // "imported"/"alreadyImported" — Core Discipline #4)
  // -------------------------------------------------------------------

  async confirm(): Promise<void> {
    if (
      this.state.phase !== "confirmationReady" &&
      this.state.phase !== "confirmFailed" &&
      this.state.phase !== "previewReady" &&
      this.state.phase !== "previewFailed"
    ) {
      throw new Error(`data-hub client: confirm() called from unexpected phase "${this.state.phase}".`);
    }
    const { batch, worksheet } = this.state;
    this.setState({ phase: "confirming", batch, worksheet });

    const result = await callConfirmIllegalDumping(worksheet.id, this.config);
    if (result.kind !== "response") {
      // Uncertain whether the import actually committed. This module does
      // NOT auto-retry (a blind retry of a genuinely-succeeded confirm is
      // safe — confirmDataHubWorksheet is idempotent — but a caller-visible
      // decision point is still preferred here over a silent retry loop,
      // consistent with this module's "never silently retry" discipline
      // applied everywhere else). retryConfirm() below re-issues the SAME
      // call; the server's own idempotent claim makes that safe regardless
      // of whether the original attempt actually landed.
      this.setState({
        phase: "confirmFailed",
        batch,
        worksheet,
        code: "NETWORK",
        message: result.kind === "networkUncertain" ? result.message : "The confirm response could not be parsed.",
      });
      return;
    }

    const body = result.body;
    if (!("ok" in body) || !body.ok) {
      this.setState({
        phase: "confirmFailed",
        batch,
        worksheet,
        code: "error" in body ? (body.code ?? "UNKNOWN") : "UNKNOWN",
        message: "error" in body ? body.error : "The confirmation failed for an unknown reason.",
      });
      return;
    }

    // Two genuinely distinct success shapes (5A.3B-PRE finding #5) —
    // narrowed by the real `alreadyImported` discriminant, never guessed.
    if (body.alreadyImported) {
      this.setState({ phase: "alreadyImported", batch, worksheetId: body.worksheetUploadId });
    } else {
      this.setState({
        phase: "imported",
        batch,
        worksheetId: body.worksheetUploadId,
        importedRows: body.importedRows,
        newRows: body.newRows,
        unchangedRows: body.unchangedRows,
        changedRows: body.changedRows,
      });
    }
  }

  /** Safe to call from `confirmFailed` regardless of whether the prior
   * attempt actually reached the server — confirmDataHubWorksheet's own
   * atomic claim + IMPORTED-is-idempotent design (confirmWorksheet.ts)
   * means a repeat call after a genuinely-successful-but-unconfirmed
   * attempt correctly reports `alreadyImported: true` rather than
   * double-importing rows. */
  async retryConfirm(): Promise<void> {
    if (this.state.phase !== "confirmFailed") {
      throw new Error(`data-hub client: retryConfirm() called from unexpected phase "${this.state.phase}".`);
    }
    // Re-enter via confirm()'s own confirmFailed-accepting branch.
    await this.confirm();
  }

  // -------------------------------------------------------------------
  // Data Hub 5A.3D.1 — import recovery / hydration from a persisted
  // ImportBatch id (e.g. after a page reload). ONE public entry point,
  // never auto-invoked (Section 12): constructing this session performs
  // ZERO network calls, and this method only ever runs when a caller
  // explicitly calls it. It never accepts anything beyond a batch id —
  // never a caller-supplied status, never an organisationId (Section
  // 14/17): every fact this method acts on is a FRESH server read,
  // authoritative over any assumption a caller might otherwise smuggle in.
  //
  // RECOVERY MATRIX (Section 7/8) — every persisted ImportBatch status is
  // mapped into an EXISTING DataHubImportState phase wherever one already
  // carries the right meaning; only two new, narrowly-scoped phases were
  // introduced (`resumingBatch`, `worksheetTerminal` — see their own doc
  // comments on the union above) for the two cases nothing existing could
  // honestly represent:
  //   AWAITING_UPLOAD  -> batchTerminal (never mints upload authority,
  //                       never pretends the original File still exists)
  //   PROCESSING       -> batchTerminal (non-actionable from THIS session;
  //                       never auto-retries finalize)
  //   DELETION_PENDING -> batchTerminal (display-only, matches its
  //                       existing non-resume meaning exactly)
  //   FAILED           -> reconcileFromBatchStatus's EXISTING FAILED
  //                       branch, unmodified (physicalFailed, hydrated
  //                       from the same persisted failure columns)
  //   READY            -> worksheet identity recovered via the EXISTING
  //                       listWorksheetsForBatch call; if no worksheet
  //                       exists yet, falls through to the EXISTING
  //                       runInspect()->runObtainWorksheet() chain
  //                       unmodified; if one exists, its canonicalStatus
  //                       routes it honestly (AWAITING_CONFIRMATION ->
  //                       confirmationReady; IMPORTED -> imported, using
  //                       the 5A.3D.0 authoritative importedRowCount, 0
  //                       preserved as 0, never fabricated; INELIGIBLE/
  //                       SKIPPED -> worksheetTerminal)
  //
  // STALENESS SAFETY: `resumeGeneration` is bumped synchronously before
  // this method's first await, and re-checked (together with `disposed`)
  // after every await THIS method or its own private helpers perform —
  // this bounds the protection to this method's own async gaps. Once
  // execution is handed off to an EXISTING shared chain (runInspect for a
  // not-yet-inspected READY batch, or reconcileFromBatchStatus for FAILED),
  // that chain's own existing `disposed`-only protection applies, exactly
  // as it already does for every other caller of those methods — this
  // method deliberately does not retrofit generation-awareness into
  // shared, ordinary-flow-serving private methods (doing so would risk
  // Section 19's hard "ordinary flow unchanged" requirement for no real
  // safety gain: a resume superseded that late is already a narrow,
  // synthetic race, and `disposed` still prevents any UI-visible harm from
  // it — see the independent review's own note on this boundary).
  async resumeFromBatchId(batchId: string): Promise<void> {
    const myGeneration = ++this.resumeGeneration;
    this.setState({ phase: "resumingBatch", batchId });

    const result = await callGetImportBatch(batchId, this.config);
    if (this.disposed || myGeneration !== this.resumeGeneration) return;

    if (result.kind !== "response") {
      this.setState({
        phase: "unknownError",
        message: result.kind === "networkUncertain" ? result.message : "The import batch response could not be parsed.",
        recoverable: true,
      });
      return;
    }
    const body = result.body;
    if (!("batch" in body)) {
      // Covers not-found, wrong-tenant, and malformed ids alike — read.ts's
      // own getImportBatch already collapses all three into an identical
      // BATCH_NOT_FOUND result (Section 15); this method adds no further
      // distinction on top of that.
      this.setState({ phase: "unknownError", message: body.error, recoverable: true });
      return;
    }

    const detail = body.batch;
    const batch: ImportBatchHandle = {
      id: detail.id,
      status: detail.status,
      originalFilename: detail.originalFilename,
      contentType: detail.contentType,
      sizeBytes: detail.sizeBytes,
      // Data Hub 5B.5B — the AUTHORITATIVE, persisted source, never
      // whatever this (possibly reloaded) browser tab had in memory.
      sourceSystemId: detail.sourceSystemId,
    };

    await this.runResumeFromDetail(batch, detail, myGeneration);
  }

  private async runResumeFromDetail(
    batch: ImportBatchHandle,
    detail: ImportBatchDetailDTOClient,
    myGeneration: number
  ): Promise<void> {
    switch (detail.status) {
      case "AWAITING_UPLOAD":
        this.setState({
          phase: "batchTerminal",
          batch,
          message:
            "This import was never completed, and the original file is no longer available in this browser session. Start a new import to continue.",
        });
        return;
      case "PROCESSING":
        this.setState({
          phase: "batchTerminal",
          batch,
          message: "This import is currently being processed and cannot be resumed from this browser yet. Check back shortly.",
        });
        return;
      case "DELETION_PENDING":
        this.setState({ phase: "batchTerminal", batch, message: "This import batch is pending deletion and cannot be resumed." });
        return;
      case "FAILED":
        // Reuses the EXISTING FAILED branch of reconcileFromBatchStatus
        // unmodified — same phase, same hydrated failure fields, same "no
        // invented retry" posture.
        await this.reconcileFromBatchStatus(batch, "FAILED", {
          sha256: detail.sha256,
          lastFailureCode: detail.lastFailureCode,
          lastFailureMessage: detail.lastFailureMessage,
          lastFailureRetryable: detail.lastFailureRetryable,
        });
        return;
      case "READY":
        await this.runResumeReadyWorksheetRecovery(batch, detail, myGeneration);
        return;
      default: {
        const _exhaustive: never = detail.status;
        this.setState({ phase: "unknownError", message: `Unrecognized batch status: ${String(_exhaustive)}`, recoverable: false });
      }
    }
  }

  private async runResumeReadyWorksheetRecovery(
    batch: ImportBatchHandle,
    detail: ImportBatchDetailDTOClient,
    myGeneration: number
  ): Promise<void> {
    const result = await callListWorksheets(batch.id, this.config);
    if (this.disposed || myGeneration !== this.resumeGeneration) return;

    if (result.kind === "networkUncertain") {
      this.setState({ phase: "obtainWorksheetFailed", batch, message: result.message });
      return;
    }
    if (result.kind === "malformed") {
      this.setState({ phase: "obtainWorksheetFailed", batch, message: "The worksheets list response could not be parsed." });
      return;
    }
    if (!("worksheets" in result.body)) {
      this.setState({ phase: "obtainWorksheetFailed", batch, message: result.body.error });
      return;
    }

    const worksheets = result.body.worksheets;
    if (worksheets.length === 0) {
      // Not yet inspected in any prior session — reuse EXISTING
      // reconciliation exactly as finalize-uncertainty already does for a
      // freshly-discovered READY batch (Section 7: "Do not fork a separate
      // implementation"): physicalReady (with the persisted sha256) then
      // its own unmodified auto-chain into inspect -> obtain-worksheet.
      await this.reconcileFromBatchStatus(batch, "READY", {
        sha256: detail.sha256,
        lastFailureCode: detail.lastFailureCode,
        lastFailureMessage: detail.lastFailureMessage,
        lastFailureRetryable: detail.lastFailureRetryable,
      });
      return;
    }
    if (worksheets.length !== 1) {
      this.setState({
        phase: "obtainWorksheetFailed",
        batch,
        message: `Expected exactly one CSV worksheet, found ${worksheets.length}.`,
      });
      return;
    }

    const worksheet = worksheets[0];
    switch (worksheet.canonicalStatus) {
      case "AWAITING_CONFIRMATION":
        this.setState({ phase: "confirmationReady", batch, worksheet });
        return;
      case "IMPORTED": {
        // Authoritative 5A.3D.0 read-time count — never reconstructed from
        // a prior transient confirm response, genuine zero preserved. A
        // `null` count here would contradict attachImportedRowCounts' own
        // invariant (every IMPORTED worksheet always has a real, possibly-
        // zero count) — mirrors the existing READY-but-sha256-null
        // precedent below: never fabricated, surfaced honestly instead of
        // silently coerced to 0.
        const importedRowCount = worksheet.importedRowCount;
        if (importedRowCount === null) {
          this.setState({
            phase: "unknownError",
            message: "Worksheet reports IMPORTED but no imported row count was returned.",
            recoverable: false,
          });
          return;
        }
        this.setState({ phase: "imported", batch, worksheetId: worksheet.id, importedRows: importedRowCount });
        return;
      }
      case "INELIGIBLE":
      case "SKIPPED":
        this.setState({ phase: "worksheetTerminal", batch, worksheet, reason: worksheet.canonicalStatus });
        return;
      default: {
        const _exhaustive: never = worksheet.canonicalStatus;
        this.setState({ phase: "unknownError", message: `Unrecognized worksheet status: ${String(_exhaustive)}`, recoverable: false });
      }
    }
  }
}

export function createIllegalDumpingImportSession(
  config: DataHubOrchestratorConfig = {}
): DataHubIllegalDumpingImportSession {
  return new DataHubIllegalDumpingImportSession(config);
}

// ---------------------------------------------------------------------------
// Data Hub 5A.3D.2 — history-list read. Deliberately a plain function, not a
// DataHubIllegalDumpingImportSession method: listing history is not part of
// any single import's own state machine (no phase, no lifecycle, nothing to
// dispose). Exists here — rather than a UI file importing httpClient.ts's
// listImportBatches directly — solely to preserve this package's existing,
// tested architectural boundary (tests/containment/dataHubImportContainment.test.ts:
// "no file [under app/data-hub/import/**] imports httpClient.ts directly;
// only orchestrator.ts's own public surface is used"). Thin passthrough:
// zero behavior beyond callListImportBatches itself.
// ---------------------------------------------------------------------------

export function listImportBatches(
  params: ListImportBatchesParams = {},
  config?: HttpClientConfig
): Promise<ListImportBatchesResult> {
  return callListImportBatches(params, config);
}

// ---------------------------------------------------------------------------
// Data Hub 5B.5A — SourceSystem selection read. Same rationale as
// listImportBatches immediately above: a plain function (not a session
// method — no lifecycle, no phase), existing here solely to preserve this
// package's "UI never imports httpClient.ts directly" boundary. Thin
// passthrough: zero behavior beyond callListSourceSystems itself.
// ---------------------------------------------------------------------------

export function listSourceSystems(
  params: ListSourceSystemsParams = {},
  config?: HttpClientConfig
): Promise<ListSourceSystemsResult> {
  return callListSourceSystems(params, config);
}

// ---------------------------------------------------------------------------
// Data Hub 5B.5B — SourceMapping list/detail reads. Same rationale as
// listSourceSystems immediately above: plain functions (no lifecycle, no
// phase), existing here solely to preserve this package's "UI never imports
// httpClient.ts directly" boundary. Thin passthroughs: zero behavior beyond
// the underlying httpClient.ts call itself.
// ---------------------------------------------------------------------------

export function listSourceMappings(
  params: ListSourceMappingsParams,
  config?: HttpClientConfig
): Promise<ListSourceMappingsResult> {
  return callListSourceMappings(params, config);
}

export function getSourceMapping(sourceMappingId: string, config?: HttpClientConfig) {
  return callGetSourceMapping(sourceMappingId, config);
}

export { resolveUploadPathname };
