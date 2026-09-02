import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { listImportBatches } from "@/lib/data-hub/importBatch/read";

// Data Hub 5A.2H.3 — the first live HTTP exposure of the H.2 dark
// tenant-safe read services. GET-only, read-only, manager+.
//
// TRUSTED TENANT CONTEXT: organisationId comes exclusively from
// requireRole("manager")'s own resolved session.organisationId — the
// fully effective organisation (already correctly resolving a
// super_admin's active org_override/impersonation, exactly as every
// other tenant-scoped route in this repo already relies on). NEVER
// session.homeOrganisationId, and NEVER anything derived from request
// input (query/path/body/header) — see
// tests/containment/dataHubReadRoutes.test.ts for the static proof and
// scripts/tests/dataHubReadRoutes.integration.test.ts for the
// behavioral/adversarial proof.

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

// A cursor this large cannot possibly be a genuine, well-formed
// {createdAt, id} pair (which is well under 100 characters in practice)
// — reject before it even reaches decodeCursor, as cheap defense-in-
// depth now that the cursor is a genuinely internet-facing value. This
// does not change H.2's own cursor contract/logic in any way; it is a
// route-boundary-only pre-check.
const MAX_CURSOR_LENGTH = 2000;
const INVALID_CURSOR_MESSAGE =
  "The pagination cursor provided is not valid. Request the first page again without a cursor.";

export async function GET(req: NextRequest) {
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

  // URLSearchParams.get() returns only the FIRST occurrence of a
  // repeated query parameter — the Web standard, unambiguous behavior;
  // no special multi-value handling is needed.
  const cursorParam = req.nextUrl.searchParams.get("cursor");
  if (cursorParam !== null && cursorParam.length > MAX_CURSOR_LENGTH) {
    return NextResponse.json({ error: INVALID_CURSOR_MESSAGE }, { status: 400, headers: CACHE_HEADERS });
  }
  const cursor = cursorParam ?? undefined;

  // No silent clamping: an unparseable or out-of-range limit is forwarded
  // as-is (Number("") is 0, Number("abc") is NaN — both already fail
  // listImportBatches' own validateLimit and produce a deterministic
  // INVALID_LIMIT) so H.2's own validation remains the single source of
  // truth for what counts as a valid limit.
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam === null ? undefined : Number(limitParam);

  try {
    const result = await listImportBatches({ organisationId: session.organisationId, cursor, limit });
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400, headers: CACHE_HEADERS });
    }
    return NextResponse.json(
      { batches: result.batches, hasNextPage: result.hasNextPage, nextCursor: result.nextCursor },
      { status: 200, headers: CACHE_HEADERS }
    );
  } catch (err) {
    console.error("[GET /api/data-hub/import-batches]", err);
    return NextResponse.json({ error: "Failed to load import batches." }, { status: 500, headers: CACHE_HEADERS });
  }
}
