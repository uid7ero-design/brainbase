// Data Hub 5A.3B — typed fetch wrapper for the six live Data Hub import
// routes. Framework-agnostic: uses only the global `fetch`/`AbortController`
// (available in every evergreen browser and in Next.js's client bundle —
// no Next.js-specific import anywhere in this file), so this module has no
// dependency on being rendered inside any particular framework.
//
// Every function here returns a TransportResult<TBody> (types.ts) — never
// throws for an ordinary network failure, timeout, or non-2xx response.
// The ONLY thing this file ever throws for is a genuine programmer error
// (e.g. calling it with a malformed `baseUrl`), which is not part of this
// module's public contract and is not expected to happen at runtime.
//
// AUTH: this module never attaches or manages any credential of its own.
// It relies entirely on the browser's ambient same-origin session cookie
// (the two-layer auth this repo's every other Data Hub caller already
// relies on) — `credentials: "same-origin"` is passed explicitly on every
// call so this still behaves correctly even if a caller's own fetch
// polyfill or global override changes the default.

import type {
  ConfirmIllegalDumpingResponseBody,
  ConfirmIllegalDumpingResult,
  FinalizeResponseBody,
  FinalizeResult,
  GetImportBatchResponseBody,
  GetImportBatchResult,
  InitiateRequestInput,
  InitiateResponseBody,
  InitiateResult,
  InspectResponseBody,
  InspectResult,
  ListImportBatchesResponseBody,
  ListImportBatchesResult,
  ListSourceSystemsResponseBody,
  ListSourceSystemsResult,
  ListWorksheetsResponseBody,
  ListWorksheetsResult,
  TransportResult,
  WorksheetPreviewResponseBody,
  WorksheetPreviewResult,
} from "./types";

export interface HttpClientConfig {
  /** Prefixed to every route path. Defaults to "" (same-origin, relative
   * URLs) — the normal case for a client bundled into this same Next.js
   * app. */
  baseUrl?: string;
  /** Injectable for tests; defaults to the global `fetch`. Never resolved
   * lazily per-call beyond this — a config built once and reused is
   * expected to keep observing the same fetchImpl for its whole lifetime. */
  fetchImpl?: typeof fetch;
  /** Per-call timeout. A timeout is reported as `networkUncertain`
   * (reason: "timeout"), never as a domain failure — see types.ts's own
   * TransportNetworkUncertain comment. Default 30_000ms. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function resolveFetch(config: HttpClientConfig | undefined): typeof fetch {
  const impl = config?.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!impl) {
    throw new Error(
      "data-hub client: no fetch implementation available. Pass `fetchImpl` explicitly in a non-browser environment (e.g. tests)."
    );
  }
  return impl;
}

function resolveUrl(config: HttpClientConfig | undefined, path: string): string {
  const base = config?.baseUrl ?? "";
  return `${base}${path}`;
}

/**
 * Combines a caller-supplied AbortSignal (if any) with this call's own
 * timeout into a single signal, so BOTH a caller-initiated abort and an
 * internally-enforced timeout are surfaced through the exact same
 * `AbortSignal.aborted` mechanism `fetch` already understands — no manual
 * bookkeeping of "did the caller cancel or did we time out" is needed here;
 * that distinction is reconstructed afterward from which signal fired.
 */
function withTimeout(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void; timedOutRef: { current: boolean } } {
  const controller = new AbortController();
  const timedOutRef = { current: false };

  const timer = setTimeout(() => {
    timedOutRef.current = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const cleanup = () => {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  };

  return { signal: controller.signal, cleanup, timedOutRef };
}

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Executes one fetch call and classifies its outcome into exactly one of
 * TransportResult's three cases. `parse` is expected to just be
 * `res.json()` cast to the expected body shape — this function never
 * attempts to narrow/validate the parsed shape beyond "is it valid JSON";
 * narrowing by domain discriminant (ok/outcome/alreadyImported/etc.) is the
 * orchestrator's job, one layer up, exactly as types.ts's own module header
 * describes.
 */
async function executeCall<TBody>(
  config: HttpClientConfig | undefined,
  input: RequestInfo,
  init: RequestInit,
  callOptions: CallOptions | undefined
): Promise<TransportResult<TBody>> {
  const fetchImpl = resolveFetch(config);
  const timeoutMs = callOptions?.timeoutMs ?? config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { signal, cleanup, timedOutRef } = withTimeout(callOptions?.signal, timeoutMs);

  let res: Response;
  try {
    res = await fetchImpl(input, { ...init, signal, credentials: "same-origin" });
  } catch (err) {
    cleanup();
    if (timedOutRef.current) {
      return { kind: "networkUncertain", reason: "timeout", message: `Request timed out after ${timeoutMs}ms.`, cause: err };
    }
    if (callOptions?.signal?.aborted) {
      return { kind: "networkUncertain", reason: "aborted", message: "Request was aborted by the caller.", cause: err };
    }
    return {
      kind: "networkUncertain",
      reason: "networkError",
      message: err instanceof Error ? err.message : "Network request failed.",
      cause: err,
    };
  }
  cleanup();

  const rawBody = await res.text();
  if (rawBody.length === 0) {
    // A well-formed-but-empty body is treated as malformed: every route
    // this client calls always returns a JSON body, success or failure.
    return { kind: "malformed", httpStatus: res.status, rawBody, parseError: new Error("Empty response body.") };
  }
  try {
    const body = JSON.parse(rawBody) as TBody;
    return { kind: "response", httpStatus: res.status, body };
  } catch (parseError) {
    return { kind: "malformed", httpStatus: res.status, rawBody, parseError };
  }
}

// ---------------------------------------------------------------------------
// POST /api/data-hub/import-batches (initiate)
// ---------------------------------------------------------------------------

export interface InitiateCallInput extends InitiateRequestInput {
  /** REQUIRED. Sent as the `Idempotency-Key` HTTP header — never as a JSON
   * body field (the server route reads it exclusively from the header; see
   * initiate.ts's own normalizeIdempotencyKey, which rejects a missing/
   * empty key with INVALID_REQUEST before any DB or storage work). Callers
   * MUST reuse the exact same key across a retry of the SAME logical
   * upload attempt — see orchestrator.ts for the one place this repo
   * generates and threads that key through. */
  idempotencyKey: string;
}

export async function initiateImportBatch(
  input: InitiateCallInput,
  config?: HttpClientConfig,
  callOptions?: CallOptions
): Promise<InitiateResult> {
  const { idempotencyKey, ...body } = input;
  return executeCall<InitiateResponseBody>(
    config,
    resolveUrl(config, "/api/data-hub/import-batches"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Header, never a body field — see InitiateCallInput's own comment.
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    },
    callOptions
  );
}

// ---------------------------------------------------------------------------
// POST /api/data-hub/import-batches/[id]/finalize
// ---------------------------------------------------------------------------

export async function finalizeImportBatch(
  importBatchId: string,
  config?: HttpClientConfig,
  callOptions?: CallOptions
): Promise<FinalizeResult> {
  return executeCall<FinalizeResponseBody>(
    config,
    resolveUrl(config, `/api/data-hub/import-batches/${encodeURIComponent(importBatchId)}/finalize`),
    { method: "POST" },
    callOptions
  );
}

// ---------------------------------------------------------------------------
// GET /api/data-hub/import-batches — history list (Data Hub 5A.3D.2).
//
// Composes the EXISTING canonical read route only — no new backend endpoint.
// `cursor`/`limit` are passed through EXACTLY as the caller supplies them
// (this module performs no clamping/defaulting of its own); the server's own
// listImportBatches validation remains the single source of truth, exactly
// as the sibling GET routes in this file already rely on. Never sends any
// tenant/identity field — organisationId is resolved server-side only, from
// the session, never from this client.
// ---------------------------------------------------------------------------

export interface ListImportBatchesParams {
  /** Opaque cursor from a prior page's nextCursor. Omit for the first page. */
  cursor?: string;
  limit?: number;
}

export async function listImportBatches(
  params: ListImportBatchesParams = {},
  config?: HttpClientConfig,
  callOptions?: CallOptions
): Promise<ListImportBatchesResult> {
  const search = new URLSearchParams();
  if (params.cursor !== undefined) search.set("cursor", params.cursor);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const qs = search.toString();
  return executeCall<ListImportBatchesResponseBody>(
    config,
    resolveUrl(config, `/api/data-hub/import-batches${qs ? `?${qs}` : ""}`),
    { method: "GET" },
    callOptions
  );
}

// ---------------------------------------------------------------------------
// GET /api/data-hub/import-batches/[id] — ground-truth reconciliation read.
// ---------------------------------------------------------------------------

export async function getImportBatch(
  importBatchId: string,
  config?: HttpClientConfig,
  callOptions?: CallOptions
): Promise<GetImportBatchResult> {
  return executeCall<GetImportBatchResponseBody>(
    config,
    resolveUrl(config, `/api/data-hub/import-batches/${encodeURIComponent(importBatchId)}`),
    { method: "GET" },
    callOptions
  );
}

// ---------------------------------------------------------------------------
// GET /api/data-hub/source-systems (Data Hub 5B.5A)
//
// Composes the EXISTING manager-readable list route only — no new backend
// endpoint. `active` defaults to "true" here (never sent as "all"/"false")
// since this call exists for exactly one purpose: populating the
// SourceSystem selection control with systems a manager may actually
// choose — an inactive system is never a valid NEW selection. Never sends
// any tenant/identity field — organisationId is resolved server-side only.
// ---------------------------------------------------------------------------

export interface ListSourceSystemsParams {
  cursor?: string;
  limit?: number;
}

export async function listSourceSystems(
  params: ListSourceSystemsParams = {},
  config?: HttpClientConfig,
  callOptions?: CallOptions
): Promise<ListSourceSystemsResult> {
  const search = new URLSearchParams();
  search.set("active", "true");
  if (params.cursor !== undefined) search.set("cursor", params.cursor);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  return executeCall<ListSourceSystemsResponseBody>(
    config,
    resolveUrl(config, `/api/data-hub/source-systems?${search.toString()}`),
    { method: "GET" },
    callOptions
  );
}

// ---------------------------------------------------------------------------
// POST /api/data-hub/import-batches/[id]/inspect
// ---------------------------------------------------------------------------

export async function inspectCsvWorksheet(
  importBatchId: string,
  config?: HttpClientConfig,
  callOptions?: CallOptions
): Promise<InspectResult> {
  return executeCall<InspectResponseBody>(
    config,
    resolveUrl(config, `/api/data-hub/import-batches/${encodeURIComponent(importBatchId)}/inspect`),
    { method: "POST" },
    callOptions
  );
}

// ---------------------------------------------------------------------------
// GET /api/data-hub/import-batches/[id]/worksheets — "obtain worksheet".
// ---------------------------------------------------------------------------

export async function listWorksheetsForBatch(
  importBatchId: string,
  config?: HttpClientConfig,
  callOptions?: CallOptions
): Promise<ListWorksheetsResult> {
  return executeCall<ListWorksheetsResponseBody>(
    config,
    resolveUrl(config, `/api/data-hub/import-batches/${encodeURIComponent(importBatchId)}/worksheets`),
    { method: "GET" },
    callOptions
  );
}

// ---------------------------------------------------------------------------
// GET /api/data-hub/worksheets/[id]/preview
// ---------------------------------------------------------------------------

export async function fetchWorksheetPreview(
  worksheetId: string,
  config?: HttpClientConfig,
  callOptions?: CallOptions
): Promise<WorksheetPreviewResult> {
  return executeCall<WorksheetPreviewResponseBody>(
    config,
    resolveUrl(config, `/api/data-hub/worksheets/${encodeURIComponent(worksheetId)}/preview`),
    { method: "GET" },
    callOptions
  );
}

// ---------------------------------------------------------------------------
// POST /api/data-hub/worksheets/[id]/confirm-illegal-dumping
// ---------------------------------------------------------------------------

export async function confirmIllegalDumping(
  worksheetId: string,
  config?: HttpClientConfig,
  callOptions?: CallOptions
): Promise<ConfirmIllegalDumpingResult> {
  return executeCall<ConfirmIllegalDumpingResponseBody>(
    config,
    resolveUrl(config, `/api/data-hub/worksheets/${encodeURIComponent(worksheetId)}/confirm-illegal-dumping`),
    { method: "POST" },
    callOptions
  );
}
