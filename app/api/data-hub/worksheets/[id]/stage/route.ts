import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { createOrResumeStagingRun, markRunFailed, type ActiveStagingRun } from "@/lib/data-hub/staging/dataHubRawStagingRun";
import { stageBatches, type StageBatchesFailureCode } from "@/lib/data-hub/staging/stageWorksheetRows";
import { completeStagingRun, type CompleteStagingRunFailureCode } from "@/lib/data-hub/staging/completionGate";
import { resolveMaxDurationMs } from "@/lib/data-hub/staging/stagingConfig";
import { getMessageTemplate, type FailureCode } from "@/lib/data-hub/importBatch/failureTaxonomy";

// Data Hub 6.2D4B — governed raw-staging execution endpoint.
//
// NO REQUEST BODY IS EVER READ — every input comes from the trusted
// session (organisationId, userId) and the path id (uploadId). Mirrors
// app/api/data-hub/import-batches/[id]/schema-selection/route.ts exactly.
//
// MANAGER+. Multi-request, client-driven continuation model (this
// deployment has no long-lived background worker): a single POST runs as
// many batches as fit within one request's time budget, then returns 202
// RUNNING (call again — the lease has already been gracefully yielded, so
// the next call can take over immediately, never waiting out the full
// lease window) or 200 SUCCEEDED or a FAILED/conflict/retryable outcome.
// Correction 3: the AUTHENTICATED actor completing the run
// (session.userId) is used for Upload.raw_staged_by — never the run's own
// created_by.
//
// execution_token is an internal lease-ownership secret and is NEVER
// included in any response body, at any status.
//
// REMEDIATION (point 5) — durable failure state must match API state:
//   - LEASE_LOST (from either stageBatches or completeStagingRun) means
//     this request's own view of ownership is already stale — it never
//     calls markRunFailed (the run may already be legitimately held by
//     someone else) and never reports "FAILED"; it reports a 409 conflict
//     the client should retry.
//   - STORAGE_NOT_FOUND / PROVIDER_FAILURE are transient/environmental —
//     the durable run is left exactly as it was (still RUNNING, still
//     holding its lease) and the client gets a retryable 503, never a
//     durable "FAILED" claim the run's own state doesn't back up.
//   - PARSER_REJECTED / STORAGE_INTEGRITY_MISMATCH / WORKBOOK_INTEGRITY_CHANGED
//     are genuine, non-retryable data problems: markRunFailed is called
//     atomically (conditioned on the CURRENT execution_token) before the
//     response is built, so a "FAILED" API response is only ever sent once
//     the durable run row has actually been transitioned to FAILED to
//     match. If markRunFailed itself reports the lease was already lost
//     (someone else now owns this run), the response falls back to the
//     same 409 conflict as LEASE_LOST rather than claiming FAILED.

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

type DurableFailureCode = "PARSER_REJECTED" | "STORAGE_INTEGRITY_MISMATCH" | "WORKBOOK_INTEGRITY_CHANGED";
const DURABLE_FAILURE_CODES = new Set<string>(["PARSER_REJECTED", "STORAGE_INTEGRITY_MISMATCH", "WORKBOOK_INTEGRITY_CHANGED"] satisfies DurableFailureCode[]);
const TRANSIENT_FAILURE_CODES = new Set<string>(["STORAGE_NOT_FOUND", "PROVIDER_FAILURE"]);

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

function conflictResponse(code: string) {
  return NextResponse.json(
    { ok: false, status: "CONFLICT", error: getMessageTemplate("RUN_ALREADY_IN_PROGRESS"), code },
    { status: 409, headers: CACHE_HEADERS }
  );
}

function retryableResponse(code: FailureCode) {
  return NextResponse.json(
    { ok: false, status: "RETRYABLE", error: getMessageTemplate(code), code },
    { status: 503, headers: CACHE_HEADERS }
  );
}

/**
 * Resolves a batch/completion failure code into the correct API response,
 * transitioning the durable run to FAILED first (atomically, via the
 * CURRENT execution_token) whenever — and only whenever — the API is about
 * to claim "FAILED". Never leaves the API response and the durable run
 * state disagreeing.
 */
async function respondToFailure(
  organisationId: string,
  run: ActiveStagingRun,
  code: StageBatchesFailureCode | CompleteStagingRunFailureCode
): Promise<NextResponse> {
  if (code === "LEASE_LOST") {
    return conflictResponse(code);
  }
  if (TRANSIENT_FAILURE_CODES.has(code)) {
    return retryableResponse(code as FailureCode);
  }
  if (DURABLE_FAILURE_CODES.has(code)) {
    const failed = await markRunFailed({
      organisationId,
      runId: run.id,
      executionToken: run.executionToken,
      failureCode: code,
    });
    if (!failed) {
      // Lost the lease in the narrow window between the failure being
      // discovered and marking it — someone else may now own this run.
      // Never claim FAILED for a run this request no longer controls.
      return conflictResponse("LEASE_LOST");
    }
    return NextResponse.json(
      { ok: false, status: "FAILED", error: getMessageTemplate(code as FailureCode), code },
      { status: 500, headers: CACHE_HEADERS }
    );
  }
  // INVALID_STATE and any other residual code: durable state is
  // ambiguous, never confidently "FAILED" — report it plainly without
  // touching the run.
  return NextResponse.json(
    { ok: false, status: "ERROR", error: getMessageTemplate(code as FailureCode), code },
    { status: 500, headers: CACHE_HEADERS }
  );
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await resolveSession();
  if (session instanceof NextResponse) return session;
  const { id: uploadId } = await params;

  try {
    const created = await createOrResumeStagingRun({
      organisationId: session.organisationId,
      uploadId,
      actorUserId: session.userId,
    });
    if (!created.ok) {
      const code = created.code;
      return NextResponse.json(
        { ok: false, error: getMessageTemplate(code as FailureCode), code },
        { status: code === "RUN_ALREADY_IN_PROGRESS" ? 409 : code === "BATCH_NOT_READY" || code === "STAGING_INELIGIBLE" ? 409 : 500, headers: CACHE_HEADERS }
      );
    }
    if (created.alreadyStaged) {
      return NextResponse.json({ ok: true, status: "SUCCEEDED", alreadyStaged: true }, { status: 200, headers: CACHE_HEADERS });
    }

    // REMEDIATION: governedColumns/headerRowOneBased/etc. come exclusively
    // from created.run (the run's own pinned context on resume, or the
    // fresh eligibility check on creation) — never a second, independent
    // eligibility lookup here, which would re-resolve against today's
    // active profile pointer regardless of what this specific run pinned.
    const batchResult = await stageBatches(created.run, resolveMaxDurationMs());
    if (!batchResult.ok) {
      return respondToFailure(session.organisationId, created.run, batchResult.code!);
    }

    if (!batchResult.exhausted) {
      // The lease has already been gracefully yielded inside stageBatches —
      // the very next POST can take over immediately, never waiting out
      // the lease window.
      return NextResponse.json(
        { ok: true, status: "RUNNING", persistedRowCount: batchResult.persistedRowCount, persistedCellCount: batchResult.persistedCellCount },
        { status: 202, headers: CACHE_HEADERS }
      );
    }

    const completion = await completeStagingRun({
      organisationId: session.organisationId,
      runId: created.run.id,
      executionToken: created.run.executionToken,
      completedByUserId: session.userId,
    });
    if (!completion.ok) {
      return respondToFailure(session.organisationId, created.run, completion.code);
    }

    return NextResponse.json(
      { ok: true, status: "SUCCEEDED", rowCount: completion.rowCount, cellCount: completion.cellCount },
      { status: 200, headers: CACHE_HEADERS }
    );
  } catch {
    // Never log the caught error: parser/provider/DB errors may quote
    // workbook-derived (potentially PII-classified) raw cell text.
    console.error("[POST /api/data-hub/worksheets/[id]/stage] unexpected failure");
    return NextResponse.json({ error: "Failed to stage this worksheet." }, { status: 500, headers: CACHE_HEADERS });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await resolveSession();
  if (session instanceof NextResponse) return session;
  const { id: uploadId } = await params;

  const { prisma } = await import("@/lib/prisma");
  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, organisation_id: session.organisationId, lineage_kind: "DATA_HUB" },
    select: { raw_staged_at: true, raw_row_count: true, raw_cell_count: true },
  });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404, headers: CACHE_HEADERS });
  if (upload.raw_staged_at) {
    return NextResponse.json({ ok: true, status: "SUCCEEDED", rowCount: upload.raw_row_count, cellCount: upload.raw_cell_count }, { status: 200, headers: CACHE_HEADERS });
  }

  const { dataHubRawStagingRunStatus } = await import("@/lib/data-hub/staging/dataHubRawStagingRunStatus");
  const status = await dataHubRawStagingRunStatus({ organisationId: session.organisationId, uploadId });
  return NextResponse.json(status, { status: 200, headers: CACHE_HEADERS });
}
