import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { listWorksheetsForBatch } from "@/lib/data-hub/importBatch/read";

// Data Hub 5A.2H.3 — see app/api/data-hub/import-batches/route.ts's
// header comment for the shared trusted-tenant-context discipline.
//
// A missing or tombstoned parent batch collapses to 404/BATCH_NOT_FOUND
// (never a silently-empty worksheet array) — enforced by
// listWorksheetsForBatch itself. A valid, tenant-owned batch that simply
// has no persisted worksheets yet returns 200 with an empty array.

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;

  try {
    const result = await listWorksheetsForBatch({ organisationId: session.organisationId, importBatchId: id });
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 404, headers: CACHE_HEADERS });
    }
    return NextResponse.json({ worksheets: result.worksheets }, { status: 200, headers: CACHE_HEADERS });
  } catch (err) {
    console.error("[GET /api/data-hub/import-batches/[id]/worksheets]", err);
    return NextResponse.json({ error: "Failed to load worksheets." }, { status: 500, headers: CACHE_HEADERS });
  }
}
