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
  finalizeImportBatch as callFinalize,
  getImportBatch as callGetImportBatch,
  initiateImportBatch as callInitiate,
  inspectCsvWorksheet as callInspect,
  listWorksheetsForBatch as callListWorksheets,
  type HttpClientConfig,
} from "./httpClient";
import { uploadFileDirectToBlob, resolveUploadPathname } from "./blobUpload";
import { generateIdempotencyKey } from "./fileHash";
import type {
  ConfirmFailureCodeClient,
  DataHubUploadProgress,
  ImportBatchStatus,
  InitiatedBatchDTO,
  PersistedFailureCodeClient,
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
}

function toHandle(batch: InitiatedBatchDTO): ImportBatchHandle {
  return {
    id: batch.id,
    status: batch.status,
    originalFilename: batch.originalFilename,
    contentType: batch.contentType,
    sizeBytes: batch.sizeBytes,
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
  | { phase: "confirming"; batch: ImportBatchHandle; worksheet: WorksheetSummaryDTOClient }
  | { phase: "imported"; batch: ImportBatchHandle; worksheetId: string; importedRows: number }
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
  | { phase: "unknownError"; message: string; recoverable: boolean };

export interface StartImportOptions {
  expectedSha256?: string;
  /** Reuse a specific idempotency key (e.g. resuming a session after a
   * page reload where the caller persisted the key alongside the batch
   * id). Defaults to a freshly generated one — see fileHash.ts's own
   * generateIdempotencyKey. */
  idempotencyKey?: string;
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
    this.idempotencyKey = options.idempotencyKey ?? this.genKey();
    this.currentFile = file;
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

  private async runInitiate(file: File, expectedSha256?: string): Promise<void> {
    this.setState({ phase: "initiating" });
    const idempotencyKey = this.idempotencyKey!;

    const result = await callInitiate(
      { originalFilename: file.name, declaredSizeBytes: file.size, expectedSha256, idempotencyKey },
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

    const batch = toHandle(body.batch);

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

    const result = await uploadFileDirectToBlob({
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
  // Step 6 — confirm Illegal Dumping (the ONLY step that may ever set
  // "imported"/"alreadyImported" — Core Discipline #4)
  // -------------------------------------------------------------------

  async confirm(): Promise<void> {
    if (this.state.phase !== "confirmationReady" && this.state.phase !== "confirmFailed") {
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
      this.setState({ phase: "imported", batch, worksheetId: body.worksheetUploadId, importedRows: body.importedRows });
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
}

export function createIllegalDumpingImportSession(
  config: DataHubOrchestratorConfig = {}
): DataHubIllegalDumpingImportSession {
  return new DataHubIllegalDumpingImportSession(config);
}

export { resolveUploadPathname };
