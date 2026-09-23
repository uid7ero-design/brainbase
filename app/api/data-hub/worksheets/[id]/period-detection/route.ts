import { NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import {
  detectWorksheetReportingPeriod,
  type DetectWorksheetReportingPeriodFailureCode,
} from "@/lib/data-hub/reportingPeriod/detectWorksheetReportingPeriod";

// Data Hub 6.2C3 — READ-ONLY automatic reporting-period detection for one
// worksheet. Never persists anything; acceptance is the separate
// period-detection/accept POST.
//
// MANAGER+, same as period-selection/mapping-selection/preview. TRUSTED
// TENANT CONTEXT: organisationId comes exclusively from requireRole's
// resolved session — never from query/header input. No query parameters
// are read at all.
//
// WIRE SHAPE (deliberately narrow — see detectWorksheetReportingPeriod.ts):
//   { ok: true, applicable: false }
//   { ok: true, applicable: true, outcome, period, suggestedPeriod,
//     reasonCode, requiresManualSelection }
//   { ok: false, error }
// Never the detector's evidence array, never a probed cell value, never
// the internal provenance (batch/source ids, sha256), never the profile
// key.

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

const STATUS_BY_CODE: Record<DetectWorksheetReportingPeriodFailureCode, number> = {
  WORKSHEET_NOT_FOUND: 404,
  WORKSHEET_NOT_ELIGIBLE: 409,
  BATCH_NOT_READY: 409,
  STORAGE_NOT_FOUND: 502,
  PROVIDER_FAILURE: 502,
  STORAGE_INTEGRITY_MISMATCH: 502,
  PARSER_REJECTED: 422,
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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
    const result = await detectWorksheetReportingPeriod({ organisationId: session.organisationId, worksheetId: id });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.message }, { status: STATUS_BY_CODE[result.code], headers: CACHE_HEADERS });
    }
    if (!result.applicable) {
      return NextResponse.json({ ok: true, applicable: false }, { status: 200, headers: CACHE_HEADERS });
    }

    const { detection } = result;
    return NextResponse.json(
      {
        ok: true,
        applicable: true,
        outcome: detection.outcome,
        period: detection.period ? { start: detection.period.start, end: detection.period.end } : null,
        suggestedPeriod: detection.suggestedPeriod
          ? { start: detection.suggestedPeriod.start, end: detection.suggestedPeriod.end }
          : null,
        reasonCode: detection.reasonCode,
        requiresManualSelection: detection.requiresManualSelection,
      },
      { status: 200, headers: CACHE_HEADERS }
    );
  } catch {
    // Deliberately no error object in the log line: an unexpected failure
    // inside workbook handling must never echo workbook content to logs.
    console.error("[GET /api/data-hub/worksheets/[id]/period-detection] unexpected failure");
    return NextResponse.json({ ok: false, error: "Failed to check the worksheet's reporting period." }, { status: 500, headers: CACHE_HEADERS });
  }
}
