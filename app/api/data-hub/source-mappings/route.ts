import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { listSourceMappings, createSourceMapping } from "@/lib/data-hub/sourceMapping/sourceMappings";
import { statusForFailureCode } from "@/lib/data-hub/sourceMapping/httpStatus";
import type { ActiveFilter } from "@/lib/data-hub/sourceMapping/types";

// Data Hub 5B.2 — SourceMapping list/create. Same auth/tenant discipline
// as app/api/data-hub/source-systems/route.ts.

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;
const MAX_CURSOR_LENGTH = 2000;
const INVALID_CURSOR_MESSAGE = "The pagination cursor provided is not valid. Request the first page again without a cursor.";

function isActiveFilter(v: string | null): v is ActiveFilter {
  return v === "true" || v === "false" || v === "all";
}

export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireRole("manager");
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "Forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CACHE_HEADERS });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CACHE_HEADERS });
  }

  const cursorParam = req.nextUrl.searchParams.get("cursor");
  if (cursorParam !== null && cursorParam.length > MAX_CURSOR_LENGTH) {
    return NextResponse.json({ error: INVALID_CURSOR_MESSAGE }, { status: 400, headers: CACHE_HEADERS });
  }
  const cursor = cursorParam ?? undefined;

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam === null ? undefined : Number(limitParam);

  const activeParam = req.nextUrl.searchParams.get("active");
  const active = isActiveFilter(activeParam) ? activeParam : undefined;

  // source_system_id is an OPTIONAL filter, always additionally
  // constrained by the session's own organisationId inside the service —
  // a foreign-tenant id here simply yields zero rows.
  const sourceSystemIdParam = req.nextUrl.searchParams.get("sourceSystemId") ?? undefined;

  try {
    const result = await listSourceMappings(session.organisationId, { cursor, limit, active, sourceSystemId: sourceSystemIdParam });
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: statusForFailureCode(result.code), headers: CACHE_HEADERS });
    }
    return NextResponse.json(
      { sourceMappings: result.items, hasNextPage: result.hasNextPage, nextCursor: result.nextCursor },
      { status: 200, headers: CACHE_HEADERS }
    );
  } catch (err) {
    console.error("[GET /api/data-hub/source-mappings]", err);
    return NextResponse.json({ error: "Failed to load source mappings." }, { status: 500, headers: CACHE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireRole("admin");
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "Forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CACHE_HEADERS });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CACHE_HEADERS });
  }

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

  // Hand-constructed — never a spread of `body` — so organisation_id/
  // created_by/id/timestamps/active_mapping_version_id in a malicious
  // body can never reach the service call.
  const input = { sourceSystemId: body.sourceSystemId, name: body.name };

  try {
    const result = await createSourceMapping({ organisationId: session.organisationId, userId: session.userId }, input);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: statusForFailureCode(result.code), headers: CACHE_HEADERS });
    }
    return NextResponse.json({ sourceMapping: result.sourceMapping }, { status: 201, headers: CACHE_HEADERS });
  } catch (err) {
    console.error("[POST /api/data-hub/source-mappings]", err);
    return NextResponse.json({ error: "Failed to create source mapping." }, { status: 500, headers: CACHE_HEADERS });
  }
}
