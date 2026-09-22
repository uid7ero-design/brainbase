import { NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import {
  acceptDetectedWorksheetPeriod,
  type AcceptDetectedWorksheetPeriodFailureCode,
} from "@/lib/data-hub/reportingPeriod/acceptDetectedWorksheetPeriod";

// Data Hub 6.2C3 — explicit operator acceptance of an EXACT automatically
// detected reporting period. The ONLY route that can write
// period_source = "DETECTED".
//
// NO REQUEST BODY IS READ: the client never sends dates (or anything
// else). The service recomputes detection server-side from the stored,
// hash-verified file and persists only a CURRENT applicable EXACT result
// while the worksheet is still AWAITING_CONFIRMATION.
//
// MANAGER+, same as period-selection. organisationId comes exclusively from
// requireRole's resolved session.

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

const STATUS_BY_CODE: Record<AcceptDetectedWorksheetPeriodFailureCode, number> = {
  WORKSHEET_NOT_FOUND: 404,
  WORKSHEET_NOT_ELIGIBLE: 409,
  BATCH_NOT_READY: 409,
  STORAGE_NOT_FOUND: 502,
  PROVIDER_FAILURE: 502,
  STORAGE_INTEGRITY_MISMATCH: 502,
  PARSER_REJECTED: 422,
  DETECTION_NOT_APPLICABLE: 409,
  DETECTED_PERIOD_NOT_EXACT: 409,
  DETECTION_STALE: 409,
  PERIOD_ALREADY_RECORDED: 409,
};

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  try {
    const result = await acceptDetectedWorksheetPeriod({ organisationId: session.organisationId, worksheetId: id });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.message }, { status: STATUS_BY_CODE[result.code], headers: CACHE_HEADERS });
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
  } catch {
    // No error object in the log line — see the period-detection GET route.
    console.error("[POST /api/data-hub/worksheets/[id]/period-detection/accept] unexpected failure");
    return NextResponse.json({ ok: false, error: "Failed to accept the detected reporting period." }, { status: 500, headers: CACHE_HEADERS });
  }
}
