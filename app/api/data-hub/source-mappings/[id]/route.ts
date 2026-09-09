import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { getSourceMapping, updateSourceMapping, setSourceMappingActive } from "@/lib/data-hub/sourceMapping/sourceMappings";
import { statusForFailureCode } from "@/lib/data-hub/sourceMapping/httpStatus";

// Data Hub 5B.2 — SourceMapping get/update. Same PATCH-dispatch design as
// app/api/data-hub/source-systems/[id]/route.ts. active_mapping_version_id
// is NEVER accepted here — see app/api/data-hub/source-mappings/[id]/
// activate-version/route.ts for the one dedicated, tenant/mapping-safe
// way to change it.

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;
const KNOWN_PATCH_FIELDS = new Set(["name", "active"]);

function hasUnknownField(body: Record<string, unknown>): boolean {
  return Object.keys(body).some((k) => !KNOWN_PATCH_FIELDS.has(k));
}

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
    const result = await getSourceMapping(session.organisationId, id);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: statusForFailureCode(result.code), headers: CACHE_HEADERS });
    }
    return NextResponse.json({ sourceMapping: result.sourceMapping }, { status: 200, headers: CACHE_HEADERS });
  } catch (err) {
    console.error("[GET /api/data-hub/source-mappings/[id]]", err);
    return NextResponse.json({ error: "Failed to load source mapping." }, { status: 500, headers: CACHE_HEADERS });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  if (hasUnknownField(body)) {
    return NextResponse.json({ error: "The request was not valid." }, { status: 400, headers: CACHE_HEADERS });
  }

  const hasName = "name" in body;
  const hasActive = "active" in body;
  if (!hasName && !hasActive) {
    return NextResponse.json({ error: "The request was not valid." }, { status: 400, headers: CACHE_HEADERS });
  }
  if (hasActive && typeof body.active !== "boolean") {
    return NextResponse.json({ error: "The request was not valid." }, { status: 400, headers: CACHE_HEADERS });
  }

  try {
    if (hasName) {
      const result = await updateSourceMapping(session.organisationId, id, { name: body.name });
      if (!result.ok) {
        return NextResponse.json({ error: result.message }, { status: statusForFailureCode(result.code), headers: CACHE_HEADERS });
      }
      if (!hasActive) {
        return NextResponse.json({ sourceMapping: result.sourceMapping }, { status: 200, headers: CACHE_HEADERS });
      }
    }
    const activeResult = await setSourceMappingActive(session.organisationId, id, body.active as boolean);
    if (!activeResult.ok) {
      return NextResponse.json({ error: activeResult.message }, { status: statusForFailureCode(activeResult.code), headers: CACHE_HEADERS });
    }
    return NextResponse.json({ sourceMapping: activeResult.sourceMapping }, { status: 200, headers: CACHE_HEADERS });
  } catch (err) {
    console.error("[PATCH /api/data-hub/source-mappings/[id]]", err);
    return NextResponse.json({ error: "Failed to update source mapping." }, { status: 500, headers: CACHE_HEADERS });
  }
}
