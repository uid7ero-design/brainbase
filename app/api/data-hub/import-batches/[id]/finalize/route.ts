import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { finalizeImportBatch } from "@/lib/data-hub/importBatch/finalize";
import { getMessageTemplate } from "@/lib/data-hub/importBatch/failureTaxonomy";

// Data Hub 5A.2I — the first live HTTP exposure of the dark 5A.2G.1
// finalize service (lib/data-hub/importBatch/finalize.ts). See that
// module's own header comment for the full service contract (atomic
// claim + generation-fenced completion, xlsx-free physical-file
// preflight only). This route wraps it without modifying or duplicating
// any of its claim/validation/persistence logic.
//
// TRUSTED TENANT CONTEXT: identical discipline to every other Data Hub
// route in this repo — organisationId comes exclusively from
// requireRole("manager")'s own resolved session.organisationId, never
// session.homeOrganisationId, never anything derived from request input.
//
// LOAD-BEARING STORAGE AUTHORITY: this route reads NO request body at
// all (no `req.json()` call anywhere in this file) and accepts NO
// caller-supplied storage locator of any kind (storageKey, provider,
// storeId, pathname, Blob URL, etag). The ONLY inputs to
// finalizeImportBatch are the trusted session.organisationId and the
// path `id` — the storage object that gets finalized is derived
// EXCLUSIVELY, server-side, from the tenant-scoped ImportBatch row via
// finalize.ts's own buildImportBatchKey(organisationId, importBatchId)
// call. A caller cannot redirect finalization to another object's
// key/path through any means — see
// tests/containment/dataHubInitiateFinalizeRoutes.test.ts for the static
// proof (no body parsing anywhere in this file) and
// scripts/tests/dataHubInitiateFinalizeRoutes.integration.test.ts for the
// adversarial proof (a body/query/header carrying a foreign storage key
// has zero effect on which object is finalized).
//
// CONCURRENCY: this route adds ZERO read-before-write check of its own —
// it invokes finalizeImportBatch exactly once and maps only its returned
// outcome. finalize.ts's own atomic claim and generation-fenced
// completion (see that module's own header comment for the low-level
// mechanism) are the sole correctness mechanism; a route-level precheck
// here would reintroduce exactly the TOCTOU race that mechanism already
// eliminates.
//
// STATUS SEMANTICS (frozen by the 5A.2I contract-freeze review): a
// service outcome of FAILED represents a correctly persisted
// physical-file-level failure — the API call itself succeeded, so this
// maps to HTTP 200 with the domain outcome in the body, exactly like a
// payment-decline API returning 200 with {status:"declined"}. This is
// deliberate and must never be "improved" into 400/409/422/500.
//
// READY here means PHYSICAL finalization only — it does NOT mean the
// workbook has been parsed, worksheet metadata persisted, validated, or
// imported. Nothing in this route's response implies otherwise.
//
// STALE PROCESSING: no scheduler/cron infrastructure exists in this
// repo. A batch left PROCESSING (e.g. by a crashed mid-flight attempt)
// remains governed by finalizeImportBatch's own CLAIM_REJECTED/
// ALREADY_PROCESSING outcome (409) indefinitely, until a future,
// separate operational (stale-reclaim scheduling) slice exists. This
// route does not call staleReclaim.ts and must never be modified to do
// so as a workaround.

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
    const result = await finalizeImportBatch({ organisationId: session.organisationId }, id);

    if (result.outcome === "READY") {
      return NextResponse.json(
        { ok: true, outcome: "READY", batchId: result.batchId, sha256: result.sha256 },
        { status: 200, headers: CACHE_HEADERS }
      );
    }

    if (result.outcome === "FAILED") {
      return NextResponse.json(
        {
          ok: true,
          outcome: "FAILED",
          batchId: result.batchId,
          failureCode: result.failureCode,
          failureMessage: getMessageTemplate(result.failureCode),
          retryable: result.retryable,
        },
        { status: 200, headers: CACHE_HEADERS }
      );
    }

    if (result.outcome === "OWNERSHIP_LOST") {
      return NextResponse.json(
        { ok: false, error: getMessageTemplate("OWNERSHIP_LOST") },
        { status: 409, headers: CACHE_HEADERS }
      );
    }

    // CLAIM_REJECTED — map by reason. NOT_FOUND covers both a genuinely
    // nonexistent batch id AND a wrong-tenant one identically (enforced
    // entirely by finalizeImportBatch's own tenant-scoped re-select in
    // classifyClaimFailure) — this route adds no branching that could
    // re-introduce a distinguishable outcome between those two cases.
    const statusByReason: Record<typeof result.reason, number> = {
      NOT_FOUND: 404,
      ALREADY_PROCESSING: 409,
      ALREADY_READY: 409,
      DELETION_PENDING: 409,
      TERMINAL_FAILURE: 409,
      UNEXPECTED_STATE: 500,
    };
    return NextResponse.json(
      { error: result.message },
      { status: statusByReason[result.reason], headers: CACHE_HEADERS }
    );
  } catch (err) {
    console.error("[POST /api/data-hub/import-batches/[id]/finalize]", err);
    return NextResponse.json({ error: "Failed to finalize import batch." }, { status: 500, headers: CACHE_HEADERS });
  }
}
