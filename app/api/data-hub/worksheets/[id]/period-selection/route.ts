import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { selectWorksheetPeriod } from "@/lib/data-hub/importBatch/selectWorksheetPeriod";

// Data Hub 6.2B1 — dedicated worksheet reporting-period-selection
// mutation. This is the ONLY route that can write Upload.period_start/
// period_end/period_source — never reachable through a generic PATCH
// Upload. Mirrors app/api/data-hub/worksheets/[id]/mapping-selection's
// own route shape/authorization model exactly.
//
// ROUTE SHAPE: deliberately flat (worksheets/[id]/period-selection, no
// batchId path segment), matching this domain's existing
// worksheets/[id]/{mapping-selection,preview,confirm-illegal-dumping}
// convention exactly.
//
// MANAGER+ — selecting a reporting period during an ordinary import
// review is materially different from SourceSystem-DEFINITION mutations
// (creating a SourceSystem, toggling reporting_period_required), which
// remain ADMIN+ only. This mirrors mapping-selection's own MANAGER+
// decision exactly.
//
// TRUSTED TENANT CONTEXT: organisationId comes exclusively from
// requireRole("manager")'s own resolved session.organisationId — never
// from request body/query/header input.
//
// REQUEST ALLOWLIST: exactly two fields, periodStart and periodEnd. No
// organisationId, sourceSystemId, or periodSource is ever read from the
// body — the request object is never spread into the service call. The
// server always sets periodSource to the fixed literal "MANUAL".
//
// No DELETE/reset route is added in this phase — the existing UI does not
// require clearing an unconfirmed selection (reselection, via a second
// POST with different dates, already covers "the operator changed their
// mind" while AWAITING_CONFIRMATION).

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireRole("manager");
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CACHE_HEADERS });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CACHE_HEADERS });
  }

  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "The request was not valid." }, { status: 400, headers: CACHE_HEADERS });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "The request was not valid." }, { status: 400, headers: CACHE_HEADERS });
  }

  try {
    const result = await selectWorksheetPeriod({
      organisationId: session.organisationId,
      worksheetUploadId: id,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
    });

    if (!result.ok) {
      const statusByCode: Record<typeof result.code, number> = {
        // Reachable from selectWorksheetPeriod's own implementation.
        WORKSHEET_NOT_FOUND: 404,
        WORKSHEET_NOT_ELIGIBLE: 409,
        SOURCE_LINEAGE_REQUIRED: 409,
        INVALID_REPORTING_PERIOD: 400,
        // The remaining FailureCode union members are unreachable from
        // selectWorksheetPeriod's own implementation (verified by direct
        // source read) but are included so this mapping remains
        // exhaustive against the full FailureCode type rather than
        // silently narrowing it — a future change to that service's
        // return surface will fail TypeScript compilation here rather
        // than falling through to the generic 500 handler unnoticed.
        INVALID_REQUEST: 500,
        STORAGE_NOT_FOUND: 500,
        STORAGE_METADATA_MISMATCH: 500,
        SIZE_LIMIT: 500,
        ZERO_BYTE: 500,
        HASH_MISMATCH: 500,
        PREFLIGHT_REJECTED: 500,
        PROVIDER_FAILURE: 500,
        STALE_RECLAIMED: 500,
        IDEMPOTENCY_CONFLICT: 500,
        NOT_FOUND: 500,
        INVALID_STATE: 500,
        CONFIGURATION_ERROR: 500,
        RECLAIM_NOT_ALLOWED: 500,
        OWNERSHIP_LOST: 500,
        BATCH_NOT_FOUND: 500,
        BATCH_NOT_READY: 500,
        STORAGE_INTEGRITY_MISMATCH: 500,
        PARSER_REJECTED: 500,
        PERSISTENCE_CONFLICT: 500,
        INVALID_CURSOR: 500,
        INVALID_LIMIT: 500,
        UNSUPPORTED_FORMAT: 500,
        SOURCE_SYSTEM_UNAVAILABLE: 500,
        SOURCE_MAPPING_UNAVAILABLE: 500,
        MAPPING_LINEAGE_UNAVAILABLE: 500,
        MAPPING_DOCUMENT_INVALID: 500,
        MAPPING_COMPILE_FAILED: 500,
        SOURCE_ALREADY_IMPORTED: 500,
        DUPLICATE_SOURCE_EXTERNAL_ID_IN_WORKSHEET: 500,
        RECONCILIATION_HISTORY_INCONSISTENT: 500,
        REPORTING_PERIOD_REQUIRED: 500,
      };
      return NextResponse.json({ ok: false, error: result.message }, { status: statusByCode[result.code], headers: CACHE_HEADERS });
    }

    return NextResponse.json(
      {
        ok: true,
        worksheetUploadId: result.worksheetUploadId,
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        periodSource: result.periodSource,
      },
      { status: 200, headers: CACHE_HEADERS }
    );
  } catch (err) {
    console.error("[POST /api/data-hub/worksheets/[id]/period-selection]", err);
    return NextResponse.json({ error: "Failed to select worksheet reporting period." }, { status: 500, headers: CACHE_HEADERS });
  }
}
