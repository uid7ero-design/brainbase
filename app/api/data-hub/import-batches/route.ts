import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { listImportBatches } from "@/lib/data-hub/importBatch/read";
import { initiateImportBatch, type InitiateClientInput } from "@/lib/data-hub/importBatch/initiate";
import { getMessageTemplate } from "@/lib/data-hub/importBatch/failureTaxonomy";

// Data Hub 5A.2H.3 — the first live HTTP exposure of the H.2 dark
// tenant-safe read services. GET-only, read-only, manager+.
//
// Data Hub 5A.2I — this file's POST handler is the first live HTTP
// exposure of the dark 5A.2G.1 initiate service (lib/data-hub/importBatch/
// initiate.ts). See that module's own header comment for the full
// service contract (insert-first idempotency, replay-state table,
// token-minting-after-commit ordering) — this route wraps it without
// modifying or duplicating any of its validation/persistence logic.
//
// TRUSTED TENANT CONTEXT (both GET and POST): organisationId comes
// exclusively from requireRole("manager")'s own resolved
// session.organisationId — the fully effective organisation (already
// correctly resolving a super_admin's active org_override/impersonation,
// exactly as every other tenant-scoped route in this repo already
// relies on). NEVER session.homeOrganisationId, and NEVER anything
// derived from request input (query/path/body/header) — see
// tests/containment/dataHubReadRoutes.test.ts /
// dataHubInitiateFinalizeRoutes.test.ts for the static proof and
// scripts/tests/dataHubReadRoutes.integration.test.ts /
// dataHubInitiateFinalizeRoutes.integration.test.ts for the
// behavioral/adversarial proof. The POST handler below hand-constructs
// its service input from exactly three permitted client-supplied fields
// (originalFilename, declaredSizeBytes, expectedSha256) plus the
// Idempotency-Key header — it never spreads the parsed request body,
// so an unexpected field (organisationId, organisation_id,
// homeOrganisationId, or anything else) in a malicious body can never
// reach the service call.

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

// 5A.2I — deterministic INITIATE outcome -> HTTP mapping, frozen by the
// 5A.2I contract-freeze review. INVALID_REQUEST/SIZE_LIMIT (pre-creation
// validation failures, nothing persisted) -> 400. INVALID_STATE
// (DELETION_PENDING) and IDEMPOTENCY_CONFLICT -> 409. The internal-only
// defensive NOT_FOUND code (resolveReplay's own extremely-rare "the
// P2002-causing row vanished before replay lookup" race) and any other
// unrecognized code fall through to 500 — this is an unexpected-shaped
// service outcome, not a normal caller-facing case, so it is treated the
// same as a genuine internal failure rather than guessed at.
function initiateErrorStatus(code: string): number {
  if (code === "INVALID_REQUEST" || code === "SIZE_LIMIT") return 400;
  if (code === "INVALID_STATE" || code === "IDEMPOTENCY_CONFLICT") return 409;
  return 500;
}

export async function POST(req: NextRequest) {
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

  // Transport-level malformed-body handling only — field-level domain
  // validation (filename format, size bounds, SHA format, idempotency-key
  // length) belongs entirely to initiateImportBatch itself and must never
  // be duplicated or pre-empted here.
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: getMessageTemplate("INVALID_REQUEST") }, { status: 400, headers: CACHE_HEADERS });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: getMessageTemplate("INVALID_REQUEST") }, { status: 400, headers: CACHE_HEADERS });
  }

  // Idempotency-Key is transported as an HTTP header, never a JSON body
  // field. Passed through untouched (no trim/case/length handling here)
  // so initiateImportBatch's own normalizeIdempotencyKey remains the
  // single source of truth for what counts as a valid key — a missing
  // header becomes `undefined`, which that function's own
  // `typeof raw !== "string"` runtime check already correctly rejects.
  const idempotencyKeyHeader = req.headers.get("Idempotency-Key") ?? undefined;

  // Hand-constructed from exactly three permitted body fields — never a
  // spread of `body` — so an unexpected field (organisationId,
  // organisation_id, homeOrganisationId, or anything else a malicious
  // caller includes) can never reach the service call. This is the
  // load-bearing tenant-input-hardening property this route must uphold.
  const input = {
    originalFilename: body.originalFilename,
    declaredSizeBytes: body.declaredSizeBytes,
    expectedSha256: body.expectedSha256,
    idempotencyKey: idempotencyKeyHeader,
  } as InitiateClientInput;

  try {
    const result = await initiateImportBatch({ organisationId: session.organisationId, userId: session.userId }, input);

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: initiateErrorStatus(result.code), headers: CACHE_HEADERS });
    }

    // Explicit, hand-constructed response DTO — never a spread of
    // `result.batch` (an ImportBatchIdentity, which internally carries
    // storageKey — a value this response must never expose). originalFilename
    // and expectedSha256 are echoed back from the client's OWN submitted
    // values (ImportBatchIdentity itself carries neither field) — harmless,
    // and useful for client-side bookkeeping; never sourced from anything
    // storage-internal.
    return NextResponse.json(
      {
        batch: {
          id: result.batch.id,
          status: result.batch.status,
          originalFilename: typeof body.originalFilename === "string" ? body.originalFilename : null,
          contentType: result.batch.contentType,
          sizeBytes: result.batch.sizeBytes,
          expectedSha256: typeof body.expectedSha256 === "string" ? body.expectedSha256 : null,
          attemptCount: result.batch.attemptCount,
          lastFailureCode: result.batch.lastFailureCode,
        },
        uploadToken: result.uploadToken,
        configurationError: result.configurationError,
      },
      // Both a genuinely fresh row and an idempotent replay of an
      // AWAITING_UPLOAD/FAILED-retry-eligible row are indistinguishable
      // from this service's own return shape (InitiateImportBatchResult
      // carries no "was this newly created" flag) — see this route's own
      // PR description / the 5A.2I implementation report for the explicit,
      // reported deviation from the contract-freeze's aspirational
      // 201-fresh/200-replay split. Every ok:true response (including the
      // configurationError:true soft-failure case) uses 200 uniformly; the
      // response body's own fields (batch.status, uploadToken,
      // configurationError) already fully convey the real state.
      { status: 200, headers: CACHE_HEADERS }
    );
  } catch (err) {
    console.error("[POST /api/data-hub/import-batches]", err);
    return NextResponse.json({ error: "Failed to initiate import batch." }, { status: 500, headers: CACHE_HEADERS });
  }
}
