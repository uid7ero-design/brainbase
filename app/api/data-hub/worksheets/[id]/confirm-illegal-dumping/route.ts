import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { confirmDataHubWorksheet } from "@/lib/data-hub/importBatch/confirmWorksheet";

// Data Hub 5A.2K.2 — the first live HTTP exposure of the dark 5A.2K.1
// canonical DATA_HUB worksheet confirmation service
// (lib/data-hub/importBatch/confirmWorksheet.ts). This route wraps it
// without modifying or duplicating any of its claim/validation/
// persistence logic.
//
// DOMAIN-SPECIFIC ROUTE IS THE IMPORTER-SELECTION BOUNDARY: this path
// (.../confirm-illegal-dumping) is deliberately NOT a generic
// `/confirm` endpoint accepting a caller-supplied importer/domain
// field. confirmDataHubWorksheet is itself hardcoded to the
// illegal-dumping importer — there is no dispatch table, no caller
// choice to secure, because there is no caller choice at all. This
// route reads NO request body (no `req.json()` anywhere in this file),
// so even a client that sends an `importer`/`domain`/`schemaType` field
// has zero effect.
//
// TRUSTED TENANT CONTEXT: identical discipline to every other Data Hub
// route — organisationId comes exclusively from requireRole("manager")'s
// own resolved session.organisationId, never session.homeOrganisationId,
// never anything derived from request input.
//
// CONFIRMATION ACTOR (5A.2L): confirmedBy is sourced exclusively from
// requireRole("manager")'s own resolved session.userId — same discipline,
// same trust boundary, as organisationId. No request body/query/header
// field can ever influence it (this route still reads no body at all).
//
// LOAD-BEARING STORAGE AUTHORITY: this route supplies confirmDataHubWorksheet
// with exactly {organisationId, worksheetUploadId} — the trusted
// session.organisationId and the path `id`. It never prefetches or passes
// batch/storage/format/lineage/canonical-status/worksheet-name/index into
// the service; confirmDataHubWorksheet resolves all of that itself from
// trusted DB state, exactly as it already does for every existing test.
//
// CONCURRENCY: this route adds ZERO read-before-write check of its own —
// it invokes confirmDataHubWorksheet exactly once and maps only its
// returned outcome. That service's own atomic conditional claim is the
// sole correctness mechanism; a route-level precheck here would
// reintroduce exactly the TOCTOU race that mechanism already eliminates.
//
// IDEMPOTENCY: a repeat call after IMPORTED returns 200
// {ok:true, alreadyImported:true} — never an error — exactly mirroring
// confirmDataHubWorksheet's own contract.

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
    const result = await confirmDataHubWorksheet({
      organisationId: session.organisationId,
      worksheetUploadId: id,
      // 5A.2L — confirmedBy comes exclusively from requireRole("manager")'s
      // own resolved session.userId, never from request body/query/header.
      confirmedBy: session.userId,
    });

    if (result.ok) {
      if (result.alreadyImported) {
        return NextResponse.json(
          { ok: true, alreadyImported: true, worksheetUploadId: result.worksheetUploadId },
          { status: 200, headers: CACHE_HEADERS }
        );
      }
      return NextResponse.json(
        {
          ok: true,
          alreadyImported: false,
          worksheetUploadId: result.worksheetUploadId,
          // 6.1B — importedRows preserves its pre-6.1B meaning; newRows/
          // unchangedRows/changedRows are new, additive fields.
          importedRows: result.importedRows,
          newRows: result.newRows,
          unchangedRows: result.unchangedRows,
          changedRows: result.changedRows,
        },
        { status: 200, headers: CACHE_HEADERS }
      );
    }

    const statusByCode: Record<typeof result.code, number> = {
      // Reused from failureTaxonomy.ts's existing PersistedFailureCode /
      // CallerOnlyOutcomeCode set (Section 43 — prefer existing codes).
      // Every branch confirmDataHubWorksheet can actually return is listed
      // explicitly; none of these is guessed.
      WORKSHEET_NOT_FOUND: 404,
      WORKSHEET_NOT_ELIGIBLE: 409,
      BATCH_NOT_READY: 409,
      UNSUPPORTED_FORMAT: 422,
      STORAGE_NOT_FOUND: 404,
      PROVIDER_FAILURE: 500,
      STORAGE_INTEGRITY_MISMATCH: 500,
      PARSER_REJECTED: 422,
      // The remaining FailureCode union members are unreachable from
      // confirmDataHubWorksheet's own implementation (verified by direct
      // source read) but are included so this mapping remains exhaustive
      // against the full FailureCode type rather than silently narrowing
      // it — a future change to that service's return surface will fail
      // TypeScript compilation here rather than falling through to the
      // generic 500 handler unnoticed.
      STORAGE_METADATA_MISMATCH: 500,
      SIZE_LIMIT: 500,
      ZERO_BYTE: 500,
      HASH_MISMATCH: 500,
      PREFLIGHT_REJECTED: 500,
      STALE_RECLAIMED: 500,
      INVALID_REQUEST: 500,
      IDEMPOTENCY_CONFLICT: 500,
      NOT_FOUND: 500,
      INVALID_STATE: 500,
      CONFIGURATION_ERROR: 500,
      RECLAIM_NOT_ALLOWED: 500,
      OWNERSHIP_LOST: 500,
      BATCH_NOT_FOUND: 500,
      PERSISTENCE_CONFLICT: 500,
      INVALID_CURSOR: 500,
      INVALID_LIMIT: 500,
      // 5B.4A — originally an initiate-only code. 6.0C1's own SourceSystem
      // row lock (see confirmWorksheet.ts's 6.0C1 header comment) can, in
      // principle, also return this if the batch's persisted
      // source_system_id no longer resolves to a real, tenant-owned row —
      // not expected in practice under this repo's deactivate-not-delete
      // architecture (SourceSystem rows are never hard-deleted), so this
      // remains a defensive/anomalous-state 500, not a normal client-facing
      // conflict.
      SOURCE_SYSTEM_UNAVAILABLE: 500,
      // 5B.4B — mapping-selection-only, unreachable from
      // confirmDataHubWorksheet (this route does not integrate mapping
      // selection/execution in this slice).
      SOURCE_MAPPING_UNAVAILABLE: 500,
      // 6.0C1 — SOURCE_LINEAGE_REQUIRED is now genuinely reachable: the
      // batch's own parent ImportBatch has no SourceSystem lineage
      // (Step 3.5's fail-closed gate). 409, matching mapping-selection's
      // own status mapping for the identical shared code.
      SOURCE_LINEAGE_REQUIRED: 409,
      // 6.0C1 (SUPERSEDED BY 6.1B) — this code is no longer emitted by
      // confirmDataHubWorksheet (per-record reconciliation replaced the
      // coarse SourceSystem-wide guard); retained here only so this
      // Record stays exhaustive against the full FailureCode union.
      SOURCE_ALREADY_IMPORTED: 409,
      // 5B.4D — frozen mapping-lineage codes, now reachable when the
      // worksheet carries a persisted Upload.mapping_version_id. 409/500
      // match previewWorksheet's own route status mapping for the two
      // shared codes exactly. MAPPING_COMPILE_FAILED is Confirm-only (see
      // failureTaxonomy.ts's own doc comment) — 422, matching
      // PARSER_REJECTED/UNSUPPORTED_FORMAT's existing treatment of a
      // client-visible structural data problem.
      MAPPING_LINEAGE_UNAVAILABLE: 409,
      MAPPING_DOCUMENT_INVALID: 500,
      MAPPING_COMPILE_FAILED: 422,
      // 6.1B — a structural data problem with the worksheet's own content
      // (two rows share one reconciliation identity), matching
      // PARSER_REJECTED/UNSUPPORTED_FORMAT's existing 422 treatment.
      // Reachable now via Step 7.5's pre-transaction duplicate check.
      DUPLICATE_SOURCE_EXTERNAL_ID_IN_WORKSHEET: 422,
      // 6.1B — an anomalous, fail-closed reconciliation-integrity state
      // (a SourceRecordIdentity exists with zero prior observations) —
      // never expected in normal operation; 500 matches this route's own
      // existing treatment of other defensive/anomalous-state codes (e.g.
      // SOURCE_SYSTEM_UNAVAILABLE, MAPPING_DOCUMENT_INVALID).
      RECONCILIATION_HISTORY_INCONSISTENT: 500,
    };
    return NextResponse.json(
      { ok: false, error: result.message },
      { status: statusByCode[result.code], headers: CACHE_HEADERS }
    );
  } catch (err) {
    console.error("[POST /api/data-hub/worksheets/[id]/confirm-illegal-dumping]", err);
    return NextResponse.json({ error: "Failed to confirm worksheet import." }, { status: 500, headers: CACHE_HEADERS });
  }
}
