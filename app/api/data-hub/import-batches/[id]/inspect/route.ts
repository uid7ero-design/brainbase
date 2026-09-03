import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { inspectCsvWorksheet } from "@/lib/data-hub/importBatch/inspectCsvWorksheet";

// Data Hub 5A.2K.2 — the first live HTTP exposure of a Data Hub worksheet
// inspection path. Wraps the dark, xlsx-free
// lib/data-hub/importBatch/inspectCsvWorksheet.ts service (CSV-classified
// batches only) without modifying or duplicating any of its persistence
// logic. The XLS/XLSX-capable inspectWorksheets.ts (5A.2H.1) remains
// completely dark — this route never imports it, directly or
// transitively — see inspectCsvWorksheet.ts's own header comment for why
// that boundary cannot be achieved by a runtime format check alone.
//
// TRUSTED TENANT CONTEXT: identical discipline to every other Data Hub
// route — organisationId comes exclusively from requireRole("manager")'s
// own resolved session.organisationId, never session.homeOrganisationId,
// never anything derived from request input.
//
// LOAD-BEARING STORAGE AUTHORITY: this route reads NO request body at all
// (no `req.json()` call anywhere in this file) and accepts NO
// caller-supplied storage locator, format, or worksheet identity of any
// kind. The ONLY inputs to inspectCsvWorksheet are the trusted
// session.organisationId and the path `id` — the storage object that gets
// inspected is derived EXCLUSIVELY, server-side, from the tenant-scoped
// ImportBatch row via inspectCsvWorksheet.ts's own
// buildImportBatchKey(organisationId, importBatchId) call.
//
// IDEMPOTENCY: inspectCsvWorksheet's own existing-set Case A-E policy is
// the sole correctness mechanism — this route adds no precheck of its
// own and simply maps the returned outcome.

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const result = await inspectCsvWorksheet({ organisationId: session.organisationId, importBatchId: id });

    if (result.ok) {
      return NextResponse.json(
        { ok: true, worksheets: result.worksheets },
        { status: 200, headers: CACHE_HEADERS }
      );
    }

    const statusByCode: Record<typeof result.code, number> = {
      BATCH_NOT_FOUND: 404,
      BATCH_NOT_READY: 409,
      UNSUPPORTED_FORMAT: 422,
      STORAGE_NOT_FOUND: 404,
      PROVIDER_FAILURE: 500,
      STORAGE_INTEGRITY_MISMATCH: 500,
      PARSER_REJECTED: 422,
      PERSISTENCE_CONFLICT: 409,
    };
    return NextResponse.json(
      { ok: false, error: result.message },
      { status: statusByCode[result.code], headers: CACHE_HEADERS }
    );
  } catch (err) {
    console.error("[POST /api/data-hub/import-batches/[id]/inspect]", err);
    return NextResponse.json({ error: "Failed to inspect import batch." }, { status: 500, headers: CACHE_HEADERS });
  }
}
