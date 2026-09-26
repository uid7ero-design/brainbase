import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { createOrResumeStagingRun } from "@/lib/data-hub/staging/dataHubRawStagingRun";
import { stageBatches } from "@/lib/data-hub/staging/stageWorksheetRows";
import { completeStagingRun } from "@/lib/data-hub/staging/completionGate";
import { resolveStagingEligibility } from "@/lib/data-hub/staging/eligibility";
import { getMessageTemplate, type FailureCode } from "@/lib/data-hub/importBatch/failureTaxonomy";

// Data Hub 6.2D4B — governed raw-staging execution endpoint.
//
// NO REQUEST BODY IS EVER READ — every input comes from the trusted
// session (organisationId, userId) and the path id (uploadId). Mirrors
// app/api/data-hub/import-batches/[id]/schema-selection/route.ts exactly.
//
// MANAGER+. Multi-request, client-driven continuation model (this
// deployment has no long-lived background worker): a single POST runs as
// many batches as fit within one request's time budget, then returns
// RUNNING (call again) or SUCCEEDED/FAILED. Correction 3: the
// AUTHENTICATED actor completing the run (session.userId) is used for
// Upload.raw_staged_by — never the run's own created_by.

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;
const MAX_DURATION_MS = 8000;

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

    const eligibility = await resolveStagingEligibility({ organisationId: session.organisationId, uploadId });
    if (!eligibility.ok) {
      return NextResponse.json({ ok: false, error: getMessageTemplate(eligibility.code as FailureCode), code: eligibility.code }, { status: 409, headers: CACHE_HEADERS });
    }

    const batchResult = await stageBatches(created.run, eligibility.governedColumns, MAX_DURATION_MS);
    if (!batchResult.ok) {
      const code = batchResult.code!;
      return NextResponse.json(
        { ok: false, status: "FAILED", error: getMessageTemplate(code as FailureCode), code },
        { status: 500, headers: CACHE_HEADERS }
      );
    }

    if (!batchResult.exhausted) {
      return NextResponse.json(
        { ok: true, status: "RUNNING", persistedRowCount: batchResult.persistedRowCount, persistedCellCount: batchResult.persistedCellCount },
        { status: 202, headers: CACHE_HEADERS }
      );
    }

    const completion = await completeStagingRun({
      organisationId: session.organisationId,
      runId: created.run.id,
      completedByUserId: session.userId,
    });
    if (!completion.ok) {
      return NextResponse.json(
        { ok: false, status: "FAILED", error: getMessageTemplate(completion.code as FailureCode), code: completion.code },
        { status: 500, headers: CACHE_HEADERS }
      );
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
