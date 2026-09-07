import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { previewWorksheet } from "@/lib/data-hub/importBatch/previewWorksheet";

// Data Hub 5A.3C.0 — the first live HTTP exposure of the bounded, read-only
// CSV worksheet preview service (lib/data-hub/importBatch/previewWorksheet.ts).
// This route wraps it without modifying or duplicating any of its
// lookup/eligibility/storage/decode logic.
//
// TRUSTED TENANT CONTEXT: identical discipline to every other Data Hub
// route — organisationId comes exclusively from requireRole("manager")'s
// own resolved session.organisationId, never session.homeOrganisationId,
// never anything derived from request input.
//
// LOAD-BEARING STORAGE AUTHORITY: this route reads NO request body at all
// (no `req.json()` call anywhere in this file) and accepts NO
// caller-supplied storage locator, format, or worksheet identity of any
// kind. The ONLY inputs to previewWorksheet are the trusted
// session.organisationId and the path `id` — the storage object that gets
// read is derived EXCLUSIVELY, server-side, from the tenant-scoped
// worksheet/ImportBatch rows via previewWorksheet.ts's own
// buildImportBatchKey(organisationId, importBatchId) call.
//
// READ-ONLY: this route never mutates ImportBatch, Upload/worksheet,
// illegal_dumping, confirmation actor/timestamp, or any failure metadata —
// previewWorksheet.ts performs zero Prisma writes.

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
    const result = await previewWorksheet({ organisationId: session.organisationId, worksheetId: id });

    if (result.ok) {
      return NextResponse.json({ ok: true, preview: result.preview }, { status: 200, headers: CACHE_HEADERS });
    }

    const statusByCode: Record<typeof result.code, number> = {
      WORKSHEET_NOT_FOUND: 404,
      WORKSHEET_NOT_ELIGIBLE: 409,
      BATCH_NOT_READY: 409,
      UNSUPPORTED_FORMAT: 422,
      STORAGE_NOT_FOUND: 404,
      PROVIDER_FAILURE: 500,
      STORAGE_INTEGRITY_MISMATCH: 500,
      PARSER_REJECTED: 422,
    };
    return NextResponse.json(
      { ok: false, error: result.message, code: result.code },
      { status: statusByCode[result.code], headers: CACHE_HEADERS }
    );
  } catch (err) {
    console.error("[GET /api/data-hub/worksheets/[id]/preview]", err);
    return NextResponse.json({ error: "Failed to load worksheet preview." }, { status: 500, headers: CACHE_HEADERS });
  }
}
