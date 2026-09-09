import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { getMappingVersion } from "@/lib/data-hub/sourceMapping/mappingVersions";
import { statusForFailureCode } from "@/lib/data-hub/sourceMapping/httpStatus";

// Data Hub 5B.2 — MappingVersion read-by-id. Read-only; no update/delete
// route exists anywhere in this domain for MappingVersion (immutable).

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireRole("manager");
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "Forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CACHE_HEADERS });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CACHE_HEADERS });
  }

  const { id } = await ctx.params;
  try {
    const result = await getMappingVersion(session.organisationId, id);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: statusForFailureCode(result.code), headers: CACHE_HEADERS });
    }
    return NextResponse.json({ mappingVersion: result.mappingVersion }, { status: 200, headers: CACHE_HEADERS });
  } catch (err) {
    console.error("[GET /api/data-hub/mapping-versions/[id]]", err);
    return NextResponse.json({ error: "Failed to load mapping version." }, { status: 500, headers: CACHE_HEADERS });
  }
}
