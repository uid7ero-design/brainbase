import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { matchImportBatchSchema } from "@/lib/data-hub/schemaMatch/matchImportBatchSchema";

// Data Hub 6.2D3C — read-only governed schema comparison for one XLSX
// ImportBatch. Returns a deterministic, structural-only difference report
// against the governed schema version (DRAFT June-v1 today). Comparing is
// NOT accepting: nothing is selected, activated, mapped, confirmed, staged
// or imported, and ImportBatch lineage columns are never written.
//
// TRUSTED TENANT CONTEXT: organisationId comes exclusively from
// requireRole("manager")'s resolved session.organisationId. This route
// reads no request body, query string or header — the service's only
// inputs are the session tenant and the path id; the governed schema is
// resolved server-side from the batch's own persisted source system.
//
// READ-ONLY: the service performs zero Prisma writes and no audit write.

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
    const result = await matchImportBatchSchema({ organisationId: session.organisationId, importBatchId: id });

    if (result.ok) {
      return NextResponse.json({ ok: true, report: result.report }, { status: 200, headers: CACHE_HEADERS });
    }

    const statusByCode: Record<typeof result.code, number> = {
      BATCH_NOT_FOUND: 404,
      BATCH_NOT_READY: 409,
      UNSUPPORTED_FORMAT: 422,
      SOURCE_LINEAGE_REQUIRED: 409,
      INVALID_STATE: 409,
      GOVERNED_SCHEMA_UNAVAILABLE: 409,
      STORAGE_NOT_FOUND: 404,
      PROVIDER_FAILURE: 500,
      STORAGE_INTEGRITY_MISMATCH: 500,
      PARSER_REJECTED: 422,
    };
    return NextResponse.json(
      { ok: false, error: result.message, code: result.code },
      { status: statusByCode[result.code], headers: CACHE_HEADERS }
    );
  } catch {
    // Never log the caught error: parser/provider/DB errors may quote
    // workbook-derived text. The client receives only the fixed message.
    console.error("[GET /api/data-hub/import-batches/[id]/schema-match] unexpected failure");
    return NextResponse.json({ error: "Failed to compare the workbook to the governed schema." }, { status: 500, headers: CACHE_HEADERS });
  }
}
