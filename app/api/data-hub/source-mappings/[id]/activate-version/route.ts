import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { activateMappingVersion } from "@/lib/data-hub/sourceMapping/mappingVersions";
import { statusForFailureCode } from "@/lib/data-hub/sourceMapping/httpStatus";

// Data Hub 5B.2 — dedicated active-version switch. This is the ONLY route
// in this domain that can change SourceMapping.active_mapping_version_id
// — never reachable through the generic PATCH /source-mappings/[id]
// route. admin+ only, per 5B architecture.

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireRole("admin");
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "Forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CACHE_HEADERS });
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

  if (typeof body.mappingVersionId !== "string" || body.mappingVersionId.length === 0) {
    return NextResponse.json({ error: "The request was not valid." }, { status: 400, headers: CACHE_HEADERS });
  }

  try {
    const result = await activateMappingVersion(session.organisationId, id, body.mappingVersionId);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: statusForFailureCode(result.code), headers: CACHE_HEADERS });
    }
    return NextResponse.json({ sourceMapping: result.sourceMapping }, { status: 200, headers: CACHE_HEADERS });
  } catch (err) {
    console.error("[POST /api/data-hub/source-mappings/[id]/activate-version]", err);
    return NextResponse.json({ error: "Failed to activate mapping version." }, { status: 500, headers: CACHE_HEADERS });
  }
}
