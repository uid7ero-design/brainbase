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
// Data Hub 6.2B1 — reportingPeriodRequired joined the known PATCH fields.
const KNOWN_PATCH_FIELDS = new Set(["name", "description", "active", "reportingPeriodRequired"]);

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
  // Data Hub 6.2B1 — an additive third recognized field, independent of
  // name/description/active.
  const hasReportingPeriodRequired = "reportingPeriodRequired" in body;
  if (!hasMetadata && !hasActive && !hasReportingPeriodRequired) {
    return NextResponse.json({ error: "The request was not valid." }, { status: 400, headers: CACHE_HEADERS });
  }
  if (hasActive && typeof body.active !== "boolean") {
    return NextResponse.json({ error: "The request was not valid." }, { status: 400, headers: CACHE_HEADERS });
  }
  if (hasReportingPeriodRequired && typeof body.reportingPeriodRequired !== "boolean") {
    return NextResponse.json({ error: "The request was not valid." }, { status: 400, headers: CACHE_HEADERS });
  }

  try {
    if (hasMetadata || hasReportingPeriodRequired) {
      // Data Hub 6.2B1 — updateSourceSystem's own validateNameAndDescription
      // requires a real name string; a PATCH that toggles ONLY
      // reportingPeriodRequired (no name/description present) echoes back
      // the record's own CURRENT name/description unchanged, rather than
      // requiring every caller to resend metadata it never intended to
      // touch. Never a partial/best-effort write — a failed lookup here
      // fails the whole PATCH closed before any mutation is attempted.
      let nameInput = body.name;
      let descriptionInput = body.description;
      if (!hasMetadata) {
        const current = await getSourceSystem(session.organisationId, id);
        if (!current.ok) {
          return NextResponse.json({ error: current.message }, { status: statusForFailureCode(current.code), headers: CACHE_HEADERS });
        }
        nameInput = current.sourceSystem.name;
        descriptionInput = current.sourceSystem.description;
      }
      const result = await updateSourceSystem(session.organisationId, id, {
        name: nameInput,
        description: descriptionInput,
        reportingPeriodRequired: hasReportingPeriodRequired ? body.reportingPeriodRequired : undefined,
      });
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
