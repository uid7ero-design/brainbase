import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { getSourceSystem, updateSourceSystem, setSourceSystemActive } from "@/lib/data-hub/sourceMapping/sourceSystems";
import { statusForFailureCode } from "@/lib/data-hub/sourceMapping/httpStatus";

// Data Hub 5B.2 — SourceSystem get/update.
//
// PATCH dispatches to the correct dedicated service function based on
// which known field is present in the body (name/description ->
// updateSourceSystem, active -> setSourceSystemActive) — it never
// forwards the raw body to a single generic "update anything" call, and
// unknown fields are rejected before either service is reached. This
// keeps the HTTP surface matching the spec's fixed route list while the
// service layer still enforces "explicit deactivate/reactivate, never a
// generic PATCH of arbitrary columns" for the `active` transition.

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;
const KNOWN_PATCH_FIELDS = new Set(["name", "description", "active"]);

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
    const result = await getSourceSystem(session.organisationId, id);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: statusForFailureCode(result.code), headers: CACHE_HEADERS });
    }
    return NextResponse.json({ sourceSystem: result.sourceSystem }, { status: 200, headers: CACHE_HEADERS });
  } catch (err) {
    console.error("[GET /api/data-hub/source-systems/[id]]", err);
    return NextResponse.json({ error: "Failed to load source system." }, { status: 500, headers: CACHE_HEADERS });
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

  const hasMetadata = "name" in body || "description" in body;
  const hasActive = "active" in body;
  if (!hasMetadata && !hasActive) {
    return NextResponse.json({ error: "The request was not valid." }, { status: 400, headers: CACHE_HEADERS });
  }
  if (hasActive && typeof body.active !== "boolean") {
    return NextResponse.json({ error: "The request was not valid." }, { status: 400, headers: CACHE_HEADERS });
  }

  try {
    if (hasMetadata) {
      const result = await updateSourceSystem(session.organisationId, id, { name: body.name, description: body.description });
      if (!result.ok) {
        return NextResponse.json({ error: result.message }, { status: statusForFailureCode(result.code), headers: CACHE_HEADERS });
      }
      if (!hasActive) {
        return NextResponse.json({ sourceSystem: result.sourceSystem }, { status: 200, headers: CACHE_HEADERS });
      }
    }
    // hasActive branch — runs after metadata (if both present), or alone.
    const activeResult = await setSourceSystemActive(session.organisationId, id, body.active as boolean);
    if (!activeResult.ok) {
      return NextResponse.json({ error: activeResult.message }, { status: statusForFailureCode(activeResult.code), headers: CACHE_HEADERS });
    }
    return NextResponse.json({ sourceSystem: activeResult.sourceSystem }, { status: 200, headers: CACHE_HEADERS });
  } catch (err) {
    console.error("[PATCH /api/data-hub/source-systems/[id]]", err);
    return NextResponse.json({ error: "Failed to update source system." }, { status: 500, headers: CACHE_HEADERS });
  }
}
