import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { listMappingVersions, createMappingVersion } from "@/lib/data-hub/sourceMapping/mappingVersions";
import { statusForFailureCode } from "@/lib/data-hub/sourceMapping/httpStatus";

// Data Hub 5B.2 — MappingVersion list/create for one SourceMapping.
// version_number, organisation_id, created_by are entirely server-owned —
// never accepted from the request body.

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;
const MAX_CURSOR_LENGTH = 2000;
const INVALID_CURSOR_MESSAGE = "The pagination cursor provided is not valid. Request the first page again without a cursor.";

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

  const cursorParam = req.nextUrl.searchParams.get("cursor");
  if (cursorParam !== null && cursorParam.length > MAX_CURSOR_LENGTH) {
    return NextResponse.json({ error: INVALID_CURSOR_MESSAGE }, { status: 400, headers: CACHE_HEADERS });
  }
  const cursor = cursorParam ?? undefined;

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam === null ? undefined : Number(limitParam);

  try {
    const result = await listMappingVersions(session.organisationId, id, { cursor, limit });
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: statusForFailureCode(result.code), headers: CACHE_HEADERS });
    }
    return NextResponse.json(
      { mappingVersions: result.items, hasNextPage: result.hasNextPage, nextCursor: result.nextCursor },
      { status: 200, headers: CACHE_HEADERS }
    );
  } catch (err) {
    console.error("[GET /api/data-hub/source-mappings/[id]/versions]", err);
    return NextResponse.json({ error: "Failed to load mapping versions." }, { status: 500, headers: CACHE_HEADERS });
  }
}

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

  // Hand-constructed from exactly the one permitted body field
  // (mappingDocument) plus the path-derived sourceMappingId — never a
  // spread of `body`, so version_number/organisation_id/created_by/id in
  // a malicious body can never reach the service call.
  const input = { sourceMappingId: id, mappingDocument: body.mappingDocument };

  try {
    const result = await createMappingVersion({ organisationId: session.organisationId, userId: session.userId }, input);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: statusForFailureCode(result.code), headers: CACHE_HEADERS });
    }
    return NextResponse.json({ mappingVersion: result.mappingVersion }, { status: 201, headers: CACHE_HEADERS });
  } catch (err) {
    console.error("[POST /api/data-hub/source-mappings/[id]/versions]", err);
    return NextResponse.json({ error: "Failed to create mapping version." }, { status: 500, headers: CACHE_HEADERS });
  }
}
