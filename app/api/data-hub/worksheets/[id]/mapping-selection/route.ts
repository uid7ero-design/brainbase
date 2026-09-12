import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { selectWorksheetMapping } from "@/lib/data-hub/importBatch/selectWorksheetMapping";

// Data Hub 5B.4B — dedicated worksheet mapping-selection mutation. This is
// the ONLY route that can write Upload.mapping_version_id — never reachable
// through a generic PATCH Upload.
//
// ROUTE SHAPE: deliberately flat (worksheets/[id]/mapping-selection, no
// batchId path segment), matching this domain's existing
// worksheets/[id]/{preview,confirm-illegal-dumping} convention exactly.
// This structurally eliminates the "worksheet under a mismatched batchId
// path parameter" attack class — there is no second path parameter to
// mismatch. selectWorksheetMapping resolves the worksheet's real parent
// ImportBatch entirely from trusted DB state via the worksheet's own
// persisted import_batch_id, never from any client-supplied batch
// reference.
//
// MANAGER+ — using an existing, already-admin-authored, already-active
// mapping during an ordinary import is materially different from 5B.2's
// ADMIN+ mapping-DEFINITION mutations (create/update/deactivate SourceMapping,
// create MappingVersion, activate version), which remain unchanged and
// ADMIN+ only. This mirrors 5B.4A's own SourceSystem-selection role
// decision exactly.
//
// TRUSTED TENANT CONTEXT: organisationId comes exclusively from
// requireRole("manager")'s own resolved session.organisationId — never
// from request body/query/header input.
//
// REQUEST ALLOWLIST: exactly one field, sourceMappingId. No
// mappingVersionId, organisationId, sourceSystemId, versionNumber, active,
// or mappingDocument is ever read from the body — the request object is
// never spread into the service call.

const CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  try {
    const result = await selectWorksheetMapping({
      organisationId: session.organisationId,
      worksheetUploadId: id,
      sourceMappingId: body.sourceMappingId,
    });

    if (!result.ok) {
      const statusByCode: Record<typeof result.code, number> = {
        // Reachable from selectWorksheetMapping's own implementation.
        WORKSHEET_NOT_FOUND: 404,
        WORKSHEET_NOT_ELIGIBLE: 409,
        SOURCE_LINEAGE_REQUIRED: 409,
        SOURCE_MAPPING_UNAVAILABLE: 409,
        INVALID_REQUEST: 400,
        // The remaining FailureCode union members are unreachable from
        // selectWorksheetMapping's own implementation (verified by direct
        // source read) but are included so this mapping remains exhaustive
        // against the full FailureCode type rather than silently narrowing
        // it — a future change to that service's return surface will fail
        // TypeScript compilation here rather than falling through to the
        // generic 500 handler unnoticed.
        STORAGE_NOT_FOUND: 500,
        STORAGE_METADATA_MISMATCH: 500,
        SIZE_LIMIT: 500,
        ZERO_BYTE: 500,
        HASH_MISMATCH: 500,
        PREFLIGHT_REJECTED: 500,
        PROVIDER_FAILURE: 500,
        STALE_RECLAIMED: 500,
        IDEMPOTENCY_CONFLICT: 500,
        NOT_FOUND: 500,
        INVALID_STATE: 500,
        CONFIGURATION_ERROR: 500,
        RECLAIM_NOT_ALLOWED: 500,
        OWNERSHIP_LOST: 500,
        BATCH_NOT_FOUND: 500,
        BATCH_NOT_READY: 500,
        STORAGE_INTEGRITY_MISMATCH: 500,
        PARSER_REJECTED: 500,
        PERSISTENCE_CONFLICT: 500,
        INVALID_CURSOR: 500,
        INVALID_LIMIT: 500,
        UNSUPPORTED_FORMAT: 500,
        SOURCE_SYSTEM_UNAVAILABLE: 500,
        // 5B.4C — Preview-only codes, unreachable from selectWorksheetMapping.
        MAPPING_LINEAGE_UNAVAILABLE: 500,
        MAPPING_DOCUMENT_INVALID: 500,
        // 5B.4D — Confirm-only code (see failureTaxonomy.ts's own doc
        // comment), unreachable from selectWorksheetMapping.
        MAPPING_COMPILE_FAILED: 500,
        // 6.0C1 — Confirm-only code (temporary first-import/repeat-import
        // safety invariant), unreachable from selectWorksheetMapping.
        SOURCE_ALREADY_IMPORTED: 500,
        // 6.1B — Confirm-only code (duplicate reconciliation identity within
        // one worksheet), unreachable from selectWorksheetMapping.
        DUPLICATE_SOURCE_EXTERNAL_ID_IN_WORKSHEET: 500,
        // 6.1B — Confirm-only code (anomalous reconciliation-integrity
        // state), unreachable from selectWorksheetMapping.
        RECONCILIATION_HISTORY_INCONSISTENT: 500,
      };
      return NextResponse.json({ ok: false, error: result.message }, { status: statusByCode[result.code], headers: CACHE_HEADERS });
    }

    return NextResponse.json(
      {
        ok: true,
        worksheetUploadId: result.worksheetUploadId,
        sourceMappingId: result.sourceMappingId,
        mappingVersionId: result.mappingVersionId,
        versionNumber: result.versionNumber,
      },
      { status: 200, headers: CACHE_HEADERS }
    );
  } catch (err) {
    console.error("[POST /api/data-hub/worksheets/[id]/mapping-selection]", err);
    return NextResponse.json({ error: "Failed to select worksheet mapping." }, { status: 500, headers: CACHE_HEADERS });
  }
}
