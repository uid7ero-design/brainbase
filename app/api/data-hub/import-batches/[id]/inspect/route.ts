import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { inspectImportBatch } from "@/lib/data-hub/importBatch/inspectImportBatch";

// Data Hub 5A.2K.2 — the first live HTTP exposure of a Data Hub worksheet
// inspection path.
//
// Data Hub 6.2D1 — now wraps lib/data-hub/importBatch/inspectImportBatch.ts,
// which dispatches on the batch's own persisted content_type: csv -> the
// unchanged xlsx-free inspectCsvWorksheet.ts; xlsx -> the archive-guarded
// inspectWorksheets.ts (structural worksheet lineage only); xls/anything
// else -> UNSUPPORTED_FORMAT. This route is therefore the ONE authorized
// live path through which xlsx/workbookParser is loaded for inspection.
// XLSX preview and confirm remain CSV-only in their own services — this
// route cannot make an XLSX worksheet importable.
//
// TRUSTED TENANT CONTEXT: identical discipline to every other Data Hub
// route — organisationId comes exclusively from requireRole("manager")'s
// own resolved session.organisationId, never session.homeOrganisationId,
// never anything derived from request input.
//
// LOAD-BEARING STORAGE AUTHORITY: this route reads NO request body at all
// (no `req.json()` call anywhere in this file) and accepts NO
// caller-supplied storage locator, format, or worksheet identity of any
// kind. The ONLY inputs to inspectImportBatch are the trusted
// session.organisationId and the path `id` — the format that decides
// dispatch, and the storage object that gets inspected, are both derived
// EXCLUSIVELY, server-side, from the tenant-scoped ImportBatch row (each
// delegate's own buildImportBatchKey(organisationId, importBatchId) call).
//
// IDEMPOTENCY: each delegate's own existing-set Case A-E policy is the sole
// correctness mechanism — this route adds no precheck of its own and
// simply maps the returned outcome.

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
    const result = await inspectImportBatch({ organisationId: session.organisationId, importBatchId: id });

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
    // Data Hub 6.2D1 — `code` is the controlled InspectImportBatchFailureCode
    // literal (never a raw parser/storage message), already declared as an
    // optional field of the client's InspectResponseBody, so the client can
    // tell UNSUPPORTED_FORMAT/PARSER_REJECTED/STORAGE_INTEGRITY_MISMATCH/
    // PERSISTENCE_CONFLICT apart instead of recording UNKNOWN. Additive only.
    return NextResponse.json(
      { ok: false, error: result.message, code: result.code },
      { status: statusByCode[result.code], headers: CACHE_HEADERS }
    );
  } catch (err) {
    console.error("[POST /api/data-hub/import-batches/[id]/inspect]", err);
    return NextResponse.json({ error: "Failed to inspect import batch." }, { status: 500, headers: CACHE_HEADERS });
  }
}
