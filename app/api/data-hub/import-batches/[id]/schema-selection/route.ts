import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { establishImportBatchSchemaLineage } from "@/lib/data-hub/schemaMatch/establishImportBatchSchemaLineage";

// Data Hub 6.2D3D — durable governed schema lineage pin for one XLSX
// ImportBatch. This is the ONLY route that can write this ImportBatch's
// dataset-type and source-schema-version lineage.
//
// NO REQUEST BODY IS EVER READ — req.json() is never called. Any body a
// caller supplies (a schema id, dataset id, match result, "override: true",
// organisationId, actorUserId) has zero authority and zero effect: every
// input to establishImportBatchSchemaLineage comes exclusively from this
// route's own resolved session and the path id.
//
// MANAGER+ — same role bar as mapping-selection/period-selection (5B.4B,
// 6.2B1): using an existing, already-governed schema during an ordinary
// import is materially different from schema/dataset-type DEFINITION or
// ACTIVATION, which do not exist as a runtime path yet and remain a
// separate governance decision.
//
// TRUSTED TENANT CONTEXT: organisationId and actorUserId come exclusively
// from requireRole("manager")'s own resolved session — never from request
// input.

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
    const result = await establishImportBatchSchemaLineage({
      organisationId: session.organisationId,
      importBatchId: id,
      actorUserId: session.userId,
    });

    if (!result.ok) {
      const statusByCode: Record<typeof result.code, number> = {
        BATCH_NOT_FOUND: 404,
        STORAGE_NOT_FOUND: 404,
        BATCH_NOT_READY: 409,
        SOURCE_LINEAGE_REQUIRED: 409,
        GOVERNED_SCHEMA_UNAVAILABLE: 409,
        GOVERNED_SCHEMA_NOT_ACTIVE: 409,
        SCHEMA_EXACT_MATCH_REQUIRED: 409,
        SCHEMA_LINEAGE_CONFLICT: 409,
        INVALID_STATE: 409,
        UNSUPPORTED_FORMAT: 422,
        PARSER_REJECTED: 422,
        PROVIDER_FAILURE: 500,
        STORAGE_INTEGRITY_MISMATCH: 500,
      };
      return NextResponse.json(
        { ok: false, error: result.message, code: result.code },
        { status: statusByCode[result.code], headers: CACHE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        alreadySelected: result.alreadySelected,
        importBatchId: result.importBatchId,
        datasetTypeId: result.datasetTypeId,
        sourceSchemaVersionId: result.sourceSchemaVersionId,
        sourceSchemaVersionNumber: result.sourceSchemaVersionNumber,
      },
      { status: 200, headers: CACHE_HEADERS }
    );
  } catch {
    // Never log the caught error: parser/provider/DB errors may quote
    // workbook-derived text. The client receives only the fixed message.
    console.error("[POST /api/data-hub/import-batches/[id]/schema-selection] unexpected failure");
    return NextResponse.json(
      { error: "Failed to select governed schema for this import batch." },
      { status: 500, headers: CACHE_HEADERS }
    );
  }
}
