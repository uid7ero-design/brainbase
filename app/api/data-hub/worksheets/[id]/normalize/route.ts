import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { createOrResumeNormalizationRun, type CreateOrResumeNormalizationFailureCode } from "@/lib/data-hub/normalizationExecution/dataHubNormalizationRun";
import { normalizeBatches, type NormalizeBatchesFailureCode } from "@/lib/data-hub/normalizationExecution/normalizeWorksheetRows";
import { completeNormalizationRun, type CompleteNormalizationRunFailureCode } from "@/lib/data-hub/normalizationExecution/completeNormalizationRun";
import { resolveMaxDurationMs } from "@/lib/data-hub/staging/stagingConfig";

// Data Hub 6.2D4B2B — thin manager+ normalization execution endpoint.
//
// NO REQUEST BODY IS EVER READ -- every input comes from the trusted
// session (organisationId, userId) and the path id (uploadId). Exact
// structural analogue of app/api/data-hub/worksheets/[id]/stage/route.ts
// (D4B's own route), applied to normalization instead of raw staging.
//
// MANAGER+. Multi-request, client-driven continuation model (this
// deployment has no long-lived background worker): a single POST creates
// or resumes a normalization run, runs as many batches as fit within one
// request's own bounded time budget (the SAME resolveMaxDurationMs()
// resolver D4B already uses -- no second time-budget setting invented
// here), then returns 202 RUNNING (call again) or 200 SUCCEEDED or a
// FAILED/conflict/retryable/ineligible outcome.
//
// THIS ROUTE OWNS ZERO LIFECYCLE LOGIC. It calls, unchanged:
// createOrResumeNormalizationRun -> normalizeBatches -> completeNormalizationRun
// (lib/data-hub/normalizationExecution/*, built and hardened across four
// independent review rounds in 6.2D4C-B2B2A) and maps their already-closed
// result/failure-code unions onto a stable HTTP response. It never
// performs a direct normalized row/cell/finding write, never calls
// markNormalizationRunFailed itself (B2B2A's own services already own
// every FAILED disposition), and never duplicates completion
// reconciliation.
//
// execution_token is an internal lease-ownership secret and is NEVER
// included in any response body, at any status. runId is likewise never
// exposed (the next POST needs nothing but the path id to continue).
//
// FAILURE MAPPING -- CORE RULE: API state must never claim something
// stronger than durable state.
//   - LEASE_LOST (from any of the three calls) means this request's own
//     view of ownership is already stale -- reported as a 409 conflict the
//     client should retry, never a durable "FAILED" claim.
//   - PERSISTENCE_FAILURE is transient/environmental -- the durable run is
//     left exactly as B2B2A's own releaseClaimAfterResolutionFailure/
//     catch handling already left it (still RUNNING, immediately
//     re-acquirable) -- reported as a retryable 503, never FAILED.
//   - NORMALIZATION_BLOCKED means the executor has ALREADY, durably,
//     persisted structured blocking findings and transitioned the run to
//     FAILED under its own live lease (see normalizeBatches's own
//     contract) -- this route may truthfully report 422 FAILED, but never
//     returns the findings/raw values/a reconstructed detailed message,
//     and never calls markNormalizationRunFailed itself (already done).
//   - Every other create/resume failure (RAW_STAGING_NOT_COMPLETE,
//     RAW_RUN_NOT_SUCCEEDED, NORMALIZATION_INELIGIBLE,
//     PROFILE_DOCUMENT_INVALID, NORMALIZATION_PLAN_INVALID,
//     NORMALIZER_VERSION_UNSUPPORTED) reflects a state that was never
//     RUNNING in the first place -- reported as 409, never FAILED.
//   - INVALID_STATE (from any call) is deliberately never distinguished
//     from any other cause -- collapsed to a single bounded 500, exactly
//     like D4B's own route's residual-code fallback.
//
// A dedicated, LOCAL, closed message map is used (not the global
// lib/data-hub/importBatch/failureTaxonomy.ts) -- that taxonomy's own
// RUN_ALREADY_IN_PROGRESS/LEASE_LOST entries are worded for RAW STAGING,
// not normalization, and several of THIS route's failure codes
// (NORMALIZATION_BLOCKED, COMPLETION_REJECTED, NORMALIZER_VERSION_UNSUPPORTED,
// etc.) have no existing entry there at all. Broadening that shared,
// cross-cutting taxonomy for one route's own wording is not a clear
// architectural win; a small local map is preferable and is exactly what
// this file declares below.

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

type RouteFailureCode = CreateOrResumeNormalizationFailureCode | NormalizeBatchesFailureCode | CompleteNormalizationRunFailureCode;

const SAFE_MESSAGES: Record<RouteFailureCode, string> = {
  RUN_ALREADY_IN_PROGRESS: "Normalization is already in progress. Try again shortly.",
  LEASE_LOST: "Normalization state changed while this request was running. Try again.",
  PERSISTENCE_FAILURE: "Normalization could not continue because of a temporary service problem.",
  RAW_STAGING_NOT_COMPLETE: "Raw staging must complete before normalization can begin.",
  RAW_RUN_NOT_SUCCEEDED: "Raw staging must complete before normalization can begin.",
  NORMALIZATION_INELIGIBLE: "This worksheet is not currently eligible for normalization.",
  PROFILE_DOCUMENT_INVALID: "This worksheet is not currently eligible for normalization.",
  NORMALIZATION_PLAN_INVALID: "This worksheet is not currently eligible for normalization.",
  NORMALIZER_VERSION_UNSUPPORTED: "This worksheet is not currently eligible for normalization.",
  NORMALIZATION_BLOCKED: "Normalization stopped because one or more values require review.",
  COMPLETION_REJECTED: "Normalization could not be completed because reconciliation did not pass.",
  // INVALID_STATE deliberately never reveals wrong-tenant vs nonexistent
  // internal pinned object vs any other cause.
  INVALID_STATE: "Normalization could not be processed for this worksheet.",
};

async function resolveSession(): Promise<{ organisationId: string; userId: string } | NextResponse> {
  try {
    const session = await requireRole("manager");
    return { organisationId: session.organisationId, userId: session.userId };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CACHE_HEADERS });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CACHE_HEADERS });
  }
}

function createOrResumeFailureResponse(code: CreateOrResumeNormalizationFailureCode): NextResponse {
  const error = SAFE_MESSAGES[code];
  switch (code) {
    case "RUN_ALREADY_IN_PROGRESS":
    case "LEASE_LOST":
      return NextResponse.json({ ok: false, status: "CONFLICT", code, error }, { status: 409, headers: CACHE_HEADERS });
    case "PERSISTENCE_FAILURE":
      return NextResponse.json({ ok: false, status: "RETRYABLE", code, error }, { status: 503, headers: CACHE_HEADERS });
    case "RAW_STAGING_NOT_COMPLETE":
    case "RAW_RUN_NOT_SUCCEEDED":
      return NextResponse.json({ ok: false, status: "NOT_READY", code, error }, { status: 409, headers: CACHE_HEADERS });
    case "NORMALIZATION_INELIGIBLE":
    case "PROFILE_DOCUMENT_INVALID":
    case "NORMALIZATION_PLAN_INVALID":
    case "NORMALIZER_VERSION_UNSUPPORTED":
      return NextResponse.json({ ok: false, status: "INELIGIBLE", code, error }, { status: 409, headers: CACHE_HEADERS });
    case "INVALID_STATE":
    default:
      return NextResponse.json({ ok: false, status: "ERROR", code: "INVALID_STATE", error: SAFE_MESSAGES.INVALID_STATE }, { status: 500, headers: CACHE_HEADERS });
  }
}

function batchFailureResponse(code: NormalizeBatchesFailureCode): NextResponse {
  const error = SAFE_MESSAGES[code];
  switch (code) {
    case "LEASE_LOST":
      return NextResponse.json({ ok: false, status: "CONFLICT", code, error }, { status: 409, headers: CACHE_HEADERS });
    case "PERSISTENCE_FAILURE":
      return NextResponse.json({ ok: false, status: "RETRYABLE", code, error }, { status: 503, headers: CACHE_HEADERS });
    case "NORMALIZATION_BLOCKED":
      // The executor has ALREADY durably persisted findings and
      // transitioned the run to FAILED under its own live lease -- this
      // route only reports it, never disposes of the run itself.
      return NextResponse.json({ ok: false, status: "FAILED", code, error }, { status: 422, headers: CACHE_HEADERS });
  }
}

function completionFailureResponse(code: CompleteNormalizationRunFailureCode): NextResponse {
  const error = SAFE_MESSAGES[code];
  switch (code) {
    case "LEASE_LOST":
      return NextResponse.json({ ok: false, status: "CONFLICT", code, error }, { status: 409, headers: CACHE_HEADERS });
    case "COMPLETION_REJECTED":
      return NextResponse.json({ ok: false, status: "COMPLETION_REJECTED", code, error }, { status: 409, headers: CACHE_HEADERS });
    case "INVALID_STATE":
    default:
      return NextResponse.json({ ok: false, status: "ERROR", code: "INVALID_STATE", error: SAFE_MESSAGES.INVALID_STATE }, { status: 500, headers: CACHE_HEADERS });
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await resolveSession();
  if (session instanceof NextResponse) return session;
  const { id: uploadId } = await params;

  try {
    // Route-level exact Upload existence check: wrong-tenant and
    // nonexistent Upload ids collapse to IDENTICAL 404 behaviour, before
    // createOrResumeNormalizationRun is ever called -- never distinguished
    // through body or timing.
    const { prisma } = await import("@/lib/prisma");
    const upload = await prisma.upload.findFirst({
      where: { id: uploadId, organisation_id: session.organisationId, lineage_kind: "DATA_HUB" },
      select: { id: true },
    });
    if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404, headers: CACHE_HEADERS });

    const created = await createOrResumeNormalizationRun({
      organisationId: session.organisationId,
      uploadId,
      actorUserId: session.userId,
    });
    if (!created.ok) {
      return createOrResumeFailureResponse(created.code);
    }
    if (created.alreadyNormalized) {
      return NextResponse.json({ ok: true, status: "SUCCEEDED", alreadyNormalized: true }, { status: 200, headers: CACHE_HEADERS });
    }

    // created.run is the run's own pinned context (fresh eligibility on
    // create, or the run's own immutable pins on resume) -- never
    // rebuilt/re-resolved here.
    const batchResult = await normalizeBatches(created.run, resolveMaxDurationMs());
    if (!batchResult.ok) {
      return batchFailureResponse(batchResult.code!);
    }

    if (!batchResult.exhausted) {
      // The lease has already been gracefully yielded inside
      // normalizeBatches -- the very next POST can take over immediately,
      // never waiting out the lease window.
      return NextResponse.json(
        { ok: true, status: "RUNNING", persistedRowCount: batchResult.persistedRowCount, persistedCellCount: batchResult.persistedCellCount },
        { status: 202, headers: CACHE_HEADERS }
      );
    }

    const completion = await completeNormalizationRun({
      organisationId: session.organisationId,
      runId: created.run.id,
      executionToken: created.run.executionToken,
      completedByUserId: session.userId,
    });
    if (!completion.ok) {
      return completionFailureResponse(completion.code);
    }

    return NextResponse.json(
      { ok: true, status: "SUCCEEDED", rowCount: completion.rowCount, cellCount: completion.cellCount },
      { status: 200, headers: CACHE_HEADERS }
    );
  } catch {
    // Never log the caught error: it may originate from a Prisma/DB
    // failure whose own message can quote identifiers or driver-internal
    // text.
    console.error("[POST /api/data-hub/worksheets/[id]/normalize] unexpected failure");
    return NextResponse.json({ ok: false, status: "ERROR", error: "Failed to normalize this worksheet." }, { status: 500, headers: CACHE_HEADERS });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await resolveSession();
  if (session instanceof NextResponse) return session;
  const { id: uploadId } = await params;

  const { prisma } = await import("@/lib/prisma");
  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, organisation_id: session.organisationId, lineage_kind: "DATA_HUB" },
    select: { normalized_at: true, normalized_row_count: true, normalized_cell_count: true },
  });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404, headers: CACHE_HEADERS });
  if (upload.normalized_at) {
    return NextResponse.json(
      { ok: true, status: "SUCCEEDED", rowCount: upload.normalized_row_count, cellCount: upload.normalized_cell_count },
      { status: 200, headers: CACHE_HEADERS }
    );
  }

  const { dataHubNormalizationRunStatus } = await import("@/lib/data-hub/normalizationExecution/dataHubNormalizationRunStatus");
  const status = await dataHubNormalizationRunStatus({ organisationId: session.organisationId, uploadId });
  return NextResponse.json(status, { status: 200, headers: CACHE_HEADERS });
}
