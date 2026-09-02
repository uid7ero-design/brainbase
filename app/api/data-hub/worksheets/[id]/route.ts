import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { getWorksheet } from "@/lib/data-hub/importBatch/read";

// Data Hub 5A.2H.3 — see app/api/data-hub/import-batches/route.ts's
// header comment for the shared trusted-tenant-context discipline.
//
// Wrong-tenant, nonexistent, LEGACY-lineage, and tombstoned-parent
// worksheet ids all collapse to the identical 404/WORKSHEET_NOT_FOUND
// response — enforced entirely by getWorksheet itself. This route never
// distinguishes a LEGACY Upload id from a nonexistent one in any way.

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
    const result = await getWorksheet({ organisationId: session.organisationId, worksheetId: id });
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 404, headers: CACHE_HEADERS });
    }
    return NextResponse.json({ worksheet: result.worksheet }, { status: 200, headers: CACHE_HEADERS });
  } catch (err) {
    console.error("[GET /api/data-hub/worksheets/[id]]", err);
    return NextResponse.json({ error: "Failed to load worksheet." }, { status: 500, headers: CACHE_HEADERS });
  }
}
