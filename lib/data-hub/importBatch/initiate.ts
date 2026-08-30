import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { classifyFormat, FileSignatureError, type WorkbookFormat } from "../fileSignatures";
import { buildImportBatchKey } from "../storage/rawFileStore";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import { VERCEL_BLOB_PRIVATE_PROVIDER } from "../storage/vercelBlobFileStore";
import { resolveImportBatchBlobCredentials } from "./compositionRoot";
import { mintDirectUploadToken } from "./directUploadAuth";
import {
  type PersistedFailureCode,
  type FailureCode,
  isUploadTokenReplayEligible,
  getMessageTemplate,
} from "./failureTaxonomy";

// Data Hub 5A.2G.1 — initiate service (dark, route-free, transport-
// independent).
//
// AUTH BOUNDARY: this function accepts an already-resolved trusted context
// (organisationId, userId) as plain parameters — it never attempts to
// resolve its own auth/session, and it deliberately never imports
// lib/org.ts's requireRole/requireSession: those depend on next/headers'
// cookies() and server-only, and physically cannot run outside a real
// Next.js request context. This function must also be callable from tests
// and, later, staleReclaim.ts, neither of which has a request context.
//
// A FUTURE route wrapping this service MUST enforce manager+ role
// authorization (via requireRole('manager')) BEFORE ever calling it, and
// MUST derive organisationId/userId from a real, authenticated session,
// never from arbitrary request input. This is deferred because there is
// no route at all in this phase. This module provides ZERO HTTP-level
// authorization of any kind — nothing here should be read as implying
// otherwise.
//
// ID PRE-GENERATION: storage_key must be known and durably written in the
// SAME insert as the rest of the row (it is NOT NULL and UNIQUE), and
// storage_key is deterministically derived from (organisationId,
// importBatchId) via the existing buildImportBatchKey. That means the
// row's own id must be known BEFORE the insert — it cannot be left to
// Prisma's schema-level `@default(cuid())`, which is only applied when
// `id` is omitted from `create()`'s data. This module therefore generates
// its own id (node:crypto's randomUUID()) and passes it explicitly on
// create() — a UUID is just as safe/unique an opaque TEXT primary key as
// a cuid for this column, and needs no new npm dependency.
//
// INSERT-FIRST IDEMPOTENCY (Step 12): the correctness mechanism is
// INSERT-FIRST, never a pre-check SELECT — a SELECT-then-INSERT pattern
// has a genuine TOCTOU race. prisma.importBatch.create(...) is attempted
// directly; a unique-constraint violation (Prisma.PrismaClientKnownRequest
// Error with code 'P2002', the correct strong idiom — NOT this repo's own
// weaker duck-typed-cast precedent in scripts/create-onkaparinga-org.ts)
// triggers a tenant-scoped re-select via the compound
// (organisation_id, idempotency_key) unique key and a hard-fingerprint
// comparison against the existing row.
//
// SIZE_BYTES IMMUTABILITY (Step 11, load-bearing): size_bytes is set here,
// once, to the client-declared source byte size, and NEVER written again
// by any code in this service layer afterward (see finalize.ts's own
// header comment for the other half of this invariant).

export interface InitiateTrustedContext {
  /** Trusted, already-authenticated caller context — never re-derived here. */
  organisationId: string;
  userId: string;
}

export interface InitiateClientInput {
  originalFilename: string;
  declaredSizeBytes: number;
  /** Optional. Trimmed and lowercased; must be exactly 64 lowercase hex
   * characters after normalization, or the request is rejected. */
  expectedSha256?: string;
  /**
   * REQUIRED at this service's own boundary (remediation: previously
   * optional). A missing/undefined/null/non-string/empty/whitespace-only
   * key — or one whose TRIMMED length exceeds 128 UTF-16 code units — is
   * rejected with INVALID_REQUEST before any Prisma call, token mint, or
   * storage operation. This is a service-layer contract only: the
   * `idempotency_key` DATABASE COLUMN itself remains nullable (see
   * scripts/create-import-batches.sql — no migration accompanies this
   * change) because Postgres unique-constraint semantics treat every NULL
   * in the (organisation_id, idempotency_key) compound unique key as
   * distinct-from-every-other-NULL, which would silently and completely
   * disable the insert-first/P2002 duplicate-detection mechanism below for
   * any row created with a NULL key. Requiring a real key at this
   * function's boundary is what actually closes that gap for this dark
   * service; the column stays permissive for any other historical/future
   * flow until a separate, explicit migration decision addresses it.
   * Trimmed; the TRIMMED value is what gets persisted; bounded to 1-128 JS
   * UTF-16 code units after trimming; otherwise treated as a fully opaque
   * exact string (no lowercasing, no Unicode normalization).
   */
  idempotencyKey: string;
}

export interface ImportBatchIdentity {
  id: string;
  organisationId: string;
  status: "AWAITING_UPLOAD" | "PROCESSING" | "READY" | "FAILED" | "DELETION_PENDING";
  storageKey: string;
  contentType: WorkbookFormat;
  sizeBytes: number;
  attemptCount: number;
  lastFailureCode: string | null;
}

export type InitiateImportBatchResult =
  | {
      ok: true;
      batch: ImportBatchIdentity;
      /** Non-null exactly when a fresh same-key upload token was minted. */
      uploadToken: string | null;
      /**
       * True exactly when the DB row above is durably committed as
       * AWAITING_UPLOAD but token minting itself failed (Step 14) — the
       * caller should treat this as a CONFIGURATION_ERROR while still
       * having the batch's identity to retry against later. Never true
       * together with a non-null uploadToken.
       */
      configurationError: boolean;
    }
  | {
      ok: false;
      /** SIZE_LIMIT here is a caller-facing pre-creation validation
       * outcome ONLY — no row exists yet, so nothing is ever persisted
       * for this specific rejection. */
      code: FailureCode;
      message: string;
    };

const IDEMPOTENCY_KEY_MIN_LENGTH = 1;
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function normalizeExpectedSha256(raw: string | undefined): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined) return { ok: true, value: null };
  const normalized = raw.trim().toLowerCase();
  if (!SHA256_HEX_PATTERN.test(normalized)) return { ok: false };
  return { ok: true, value: normalized };
}

// `raw` is typed `unknown` deliberately: the InitiateClientInput type says
// `idempotencyKey: string` (required), but an untyped/JS caller (or an
// `as any` cast) can still hand this function `undefined`, `null`, or any
// non-string value at runtime — TypeScript's static type offers zero
// protection against that. This function is therefore the actual runtime
// enforcement boundary, not the type declaration.
function normalizeIdempotencyKey(raw: unknown): { ok: true; value: string } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };
  const trimmed = raw.trim();
  if (trimmed.length < IDEMPOTENCY_KEY_MIN_LENGTH || trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

interface Fingerprint {
  originalFilename: string;
  contentType: WorkbookFormat;
  sizeBytes: number;
  expectedSha256: string | null;
}

function toIdentity(row: {
  id: string;
  organisation_id: string;
  status: string;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  attempt_count: number;
  last_failure_code: string | null;
}): ImportBatchIdentity {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    status: row.status as ImportBatchIdentity["status"],
    storageKey: row.storage_key,
    contentType: row.content_type as WorkbookFormat,
    sizeBytes: row.size_bytes,
    attemptCount: row.attempt_count,
    lastFailureCode: row.last_failure_code,
  };
}

/**
 * Step 13's replay-state table + Step 14's DB-before-token ordering. Called
 * both for a freshly-created row and for a replayed (idempotency-matched)
 * existing row — the logic is identical either way.
 */
async function proceedAfterCreateOrReplay(
  row: Parameters<typeof toIdentity>[0]
): Promise<InitiateImportBatchResult> {
  const identity = toIdentity(row);

  if (identity.status === "DELETION_PENDING") {
    // Never issue a token against a tombstoned identity.
    return { ok: false, code: "INVALID_STATE", message: getMessageTemplate("INVALID_STATE") };
  }

  if (identity.status === "PROCESSING" || identity.status === "READY") {
    // Return current state as-is — never mint a new token.
    return { ok: true, batch: identity, uploadToken: null, configurationError: false };
  }

  let shouldMintToken = false;
  if (identity.status === "AWAITING_UPLOAD") {
    shouldMintToken = true;
  } else if (identity.status === "FAILED") {
    // Never use the DB's coarse last_failure_retryable boolean alone —
    // always consult the specific persisted code via the Step 6 predicate.
    const code = identity.lastFailureCode as PersistedFailureCode | null;
    shouldMintToken = code !== null && isUploadTokenReplayEligible(code);
  }

  if (!shouldMintToken) {
    // FAILED with a non-upload-eligible code (PROVIDER_FAILURE/
    // STALE_RECLAIMED — a finalize retry may still be possible, but
    // initiate itself never calls finalize; or a terminal bad-object code
    // — a brand-new batch under a new idempotency key is required). Either
    // way: current state as-is, no token.
    return { ok: true, batch: identity, uploadToken: null, configurationError: false };
  }

  // Token minting happens strictly AFTER the DB row is already committed
  // (Step 14) — attempted here, never before. Any failure resolving
  // credentials or minting the token (both of which can only fail for
  // configuration reasons — see compositionRoot.ts / directUploadAuth.ts)
  // leaves the row exactly as AWAITING_UPLOAD, untouched: no attempt_count
  // write, no failure-metadata write (this is not a finalize attempt and
  // never touches those columns).
  try {
    const credentials = resolveImportBatchBlobCredentials();
    const uploadToken = await mintDirectUploadToken({
      organisationId: identity.organisationId,
      importBatchId: identity.id,
      format: identity.contentType,
      storeId: credentials.storeId,
      token: credentials.token,
    });
    return { ok: true, batch: identity, uploadToken, configurationError: false };
  } catch {
    return { ok: true, batch: identity, uploadToken: null, configurationError: true };
  }
}

async function resolveReplay(
  organisationId: string,
  userId: string,
  idempotencyKey: string,
  fingerprint: Fingerprint
): Promise<InitiateImportBatchResult> {
  const existing = await prisma.importBatch.findUnique({
    where: {
      organisation_id_idempotency_key: {
        organisation_id: organisationId,
        idempotency_key: idempotencyKey,
      },
    },
  });

  if (!existing) {
    // The row that caused the unique-constraint conflict a moment ago is
    // now gone (e.g. concurrently deleted) — fail safe rather than assume.
    return { ok: false, code: "NOT_FOUND", message: getMessageTemplate("NOT_FOUND") };
  }

  // Hard fingerprint comparison — organisationId, original_filename,
  // content_type, size_bytes (immutable per Step 11), and the normalized
  // expected_sha256 or its explicit absence. The idempotency key itself is
  // deliberately NOT part of this comparison: it is the lookup key used to
  // find the row being compared against in the first place — comparing it
  // to itself would be a tautology.
  const existingExpectedSha256 = existing.expected_sha256 ?? null;
  const fingerprintMatches =
    existing.organisation_id === organisationId &&
    existing.original_filename === fingerprint.originalFilename &&
    existing.content_type === fingerprint.contentType &&
    existing.size_bytes === fingerprint.sizeBytes &&
    existingExpectedSha256 === fingerprint.expectedSha256;

  if (!fingerprintMatches) {
    return { ok: false, code: "IDEMPOTENCY_CONFLICT", message: getMessageTemplate("IDEMPOTENCY_CONFLICT") };
  }

  // uploaded_by: if the EXISTING row's value is still non-NULL, require it
  // to equal the new request's trusted userId (mismatch -> conflict). If
  // it is NULL (the original uploader was since deleted, per the FK's own
  // ON DELETE SET NULL), skip this comparison entirely — that field's
  // historical value is genuinely unrecoverable once nulled, and forcing
  // a mismatch here would make an otherwise-legitimately-replayable row
  // permanently un-replayable for no correctness benefit. Never written
  // to during a replay (set once, at creation, never touched again here).
  if (existing.uploaded_by !== null && existing.uploaded_by !== userId) {
    return { ok: false, code: "IDEMPOTENCY_CONFLICT", message: getMessageTemplate("IDEMPOTENCY_CONFLICT") };
  }

  return proceedAfterCreateOrReplay(existing);
}

/**
 * Initiates (or idempotently replays) an ImportBatch direct-upload flow.
 * Trusted context parameters (organisationId, userId) are never derived
 * internally from any request/cookie — see the AUTH BOUNDARY header
 * comment above.
 */
export async function initiateImportBatch(
  context: InitiateTrustedContext,
  input: InitiateClientInput
): Promise<InitiateImportBatchResult> {
  const { organisationId, userId } = context;

  // ---- validation (Step 10) — all caller-facing, pre-creation; nothing
  // is persisted for any rejection in this block. ----

  let format: WorkbookFormat;
  try {
    // Reused exactly from fileSignatures.ts (Step 5) — never reimplemented.
    format = classifyFormat({ filename: input.originalFilename });
  } catch (err) {
    if (err instanceof FileSignatureError) {
      return { ok: false, code: "INVALID_REQUEST", message: getMessageTemplate("INVALID_REQUEST") };
    }
    throw err;
  }

  if (!Number.isSafeInteger(input.declaredSizeBytes) || input.declaredSizeBytes <= 0) {
    return { ok: false, code: "INVALID_REQUEST", message: getMessageTemplate("INVALID_REQUEST") };
  }
  if (input.declaredSizeBytes > MAX_SOURCE_FILE_BYTES) {
    return { ok: false, code: "SIZE_LIMIT", message: getMessageTemplate("SIZE_LIMIT") };
  }

  const shaResult = normalizeExpectedSha256(input.expectedSha256);
  if (!shaResult.ok) {
    return { ok: false, code: "INVALID_REQUEST", message: getMessageTemplate("INVALID_REQUEST") };
  }
  const expectedSha256 = shaResult.value;

  const keyResult = normalizeIdempotencyKey(input.idempotencyKey);
  if (!keyResult.ok) {
    return { ok: false, code: "INVALID_REQUEST", message: getMessageTemplate("INVALID_REQUEST") };
  }
  const idempotencyKey = keyResult.value;

  const fingerprint: Fingerprint = {
    originalFilename: input.originalFilename,
    contentType: format,
    sizeBytes: input.declaredSizeBytes,
    expectedSha256,
  };

  // ---- insert-first (Step 12) ----

  const importBatchId = randomUUID();
  const storageKey = buildImportBatchKey(organisationId, importBatchId);

  let row;
  try {
    row = await prisma.importBatch.create({
      data: {
        id: importBatchId,
        organisation_id: organisationId,
        uploaded_by: userId,
        original_filename: input.originalFilename,
        content_type: format,
        size_bytes: input.declaredSizeBytes, // NEVER written again — see Step 11.
        storage_provider: VERCEL_BLOB_PRIVATE_PROVIDER,
        storage_key: storageKey,
        status: "AWAITING_UPLOAD",
        idempotency_key: idempotencyKey,
        expected_sha256: expectedSha256,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // idempotencyKey is guaranteed non-null/non-empty here — validated
      // above, before this insert was ever attempted (Step 3 remediation).
      return resolveReplay(organisationId, userId, idempotencyKey, fingerprint);
    }
    throw err;
  }

  return proceedAfterCreateOrReplay(row);
}
