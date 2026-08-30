import {
  put as blobPut,
  head as blobHead,
  get as blobGet,
  del as blobDel,
  BlobError,
  BlobNotFoundError,
} from "@vercel/blob";
import {
  RawFileStore,
  RawFileStoreError,
  RawFileMetadata,
  RawFilePutResult,
  RawFileGetOptions,
  validateStorageKey,
  validateMaxBytes,
  validateContentType,
} from "./rawFileStore";

// Data Hub private Vercel Blob adapter (Phase 5A.2F).
//
// This targets a SEPARATE, dedicated, PRIVATE Blob store from the
// pre-existing PUBLIC store Events uses (see lib/events/blobStorage.ts).
// Vercel Blob access
// mode (public/private) is fixed per-store at creation time and can
// never be mixed within one store, so these two features can never
// share a store even in principle. See
// docs/architecture/decisions/0001-data-hub-ingestion-foundation.md
// §14 for the full rationale.
//
// Cross-store safety design: createVercelBlobFileStore() takes explicit
// storeId + token in its config — never process.env, never the
// installed SDK's own default/OIDC credential resolution. This module
// never imports anything from lib/events, and never references
// BLOB_STORE_ID/BLOB_READ_WRITE_TOKEN (the Events store's default-
// prefix env vars) by name.
//
// IMPLEMENTATION-TIME SDK VERIFICATION FINDING (installed @vercel/blob
// 2.8.0, read directly from node_modules/@vercel/blob/dist/*.d.ts and
// the compiled chunk-QMTUXFZH.cjs — not assumed from documentation):
// when a `token` option is supplied, the SDK's own auth resolution
// (resolveBlobAuth) derives the ACTUAL target store from the token
// itself (parseStoreIdFromReadWriteToken) and silently ignores any
// `storeId` option passed alongside it. `storeId` only has live effect
// on the OIDC-credential auth path, which this adapter never uses.
// Consequently `token` — not `storeId` — is the operative mechanism
// that pins every call to the Data Hub store under the currently
// installed SDK version. Both are still required by this adapter's
// config and passed explicitly on every call: `storeId` remains
// meaningful documentation of intent and defense-in-depth against a
// future SDK version changing this precedence, but it must not be
// mistaken for the live guarantee — that guarantee is `token` being
// mandatory and always explicit, never env-resolved.
//
// R1 remediation: precisely because `storeId` has no live effect on
// this auth path, a mismatched `{ storeId: CORRECT, token: TOKEN_FOR_A_
// DIFFERENT_STORE }` config would previously construct successfully
// and silently target the wrong store on every call. verifyToken
// StoreIdConsistency() below closes that gap at construction time: it
// extracts the store id actually encoded in the token (via a small
// local parser matching the SDK's own verified parsing logic — see
// that function's comment) and fails closed if it does not match the
// supplied storeId, before the RawFileStore object is ever returned.
//
// A second verification finding: PutBlobResult (the resolved value of
// put()) never includes a `size` field at all, confirming the
// architecture's assumption that PUT must report size from the
// caller's own already-known `body.byteLength`, never from the
// provider response.
//
// A third finding: the installed SDK exports no dedicated typed error
// class for a same-pathname overwrite conflict (allowOverwrite: false
// hitting an existing object). The server-side "bad_request" error
// code path (chunk-QMTUXFZH.cjs's getBlobError) maps to the generic
// base `BlobError` class, indistinguishable at the type level from any
// other bad-request-shaped failure. isPutConflict() below is a
// narrow, explicitly-scoped exception to "prefer typed errors over
// message matching": message matching is used here only because no
// typed mechanism exists for this one case.
//
// Collision classification currently depends on backend-provided
// free-text wording — the "already exists" substring is a message
// Vercel's API returns at request time, not a string baked into the
// installed @vercel/blob package. Pinning @vercel/blob@2.8.0 pins the
// SDK's code paths; it does NOT pin this server-side response text,
// which can change independently of any client library version. This
// check still fails CLOSED: a non-matching message degrades
// classification to PROVIDER_FAILURE, never to a silent overwrite and
// never to a swallowed failure. A future controlled live-integration
// test against the real provisioned private store — verifying the
// actual collision response text — is a pending pre-live-exposure
// integration-gate item (5A.2G or a later phase, before this adapter
// is ever reachable from a production API route), not work completed
// here.

export const VERCEL_BLOB_PRIVATE_PROVIDER = "vercel-blob-private" as const;

export interface VercelBlobFileStoreConfig {
  /** Explicit Data Hub store id. Never read from process.env by this
   * module — the composition root (5A.2G) is responsible for resolving
   * DATAHUB_BLOB_STORE_ID and passing it in. */
  storeId: string;
  /** Explicit Data Hub read-write token. Required (not optional): see
   * the module-level comment above — this is the value that actually
   * pins every call to the Data Hub store under the installed SDK's
   * auth resolution, so silently falling back to an ambient/default
   * token is exactly the cross-store failure mode this phase must
   * prevent. */
  token: string;
}

function requireNonEmptyString(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `createVercelBlobFileStore: ${name} is required and must be a non-empty string. ` +
        "This adapter never falls back to a default Blob store or ambient credential."
    );
  }
  return value;
}

// ─── Token / storeId self-consistency (5A.2F-R1 remediation) ─────────
//
// Verified directly from the installed @vercel/blob 2.8.0 source
// (node_modules/@vercel/blob/dist/chunk-QMTUXFZH.cjs):
//
//   function parseStoreIdFromReadWriteToken(token) {
//     const [, , , storeId = ""] = token.split("_");
//     return storeId;
//   }
//   function normalizeStoreId(storeId) {
//     return storeId.startsWith("store_") ? storeId.slice("store_".length) : storeId;
//   }
//
// A Vercel Blob read-write token is shaped
// `vercel_blob_rw_<storeId>_<secret>`: splitting on "_" and taking
// index 3 recovers the store id segment the SDK itself will actually
// use to route every call (see resolveBlobAuth in the same file),
// independently of whatever `storeId` option is passed alongside it.
//
// This is a local re-implementation, not an SDK import: the package's
// public entry point (`@vercel/blob`'s package.json `exports["."]`,
// backed by dist/index.d.ts) re-exports parseStoreIdFromDelegationToken
// and parseStoreIdFromPresignedUrl, but never parseStoreIdFromRead
// WriteToken — that helper is internal to the compiled chunk and not a
// stable public API of the package, so it is not imported here.
function extractTokenStoreId(token: string): string {
  const parts = token.split("_");
  return parts[3] ?? "";
}

// Mirrors the SDK's own `normalizeStoreId` (same source file, see
// above): a manually-supplied storeId may carry a "store_" prefix (the
// shape Vercel's dashboard/env vars such as `BLOB_STORE_ID` use), while
// the segment embedded inside a token never does. Both sides of the
// comparison in verifyTokenStoreIdConsistency() must be normalized the
// same way, or a correctly-matched pair would be misreported as
// inconsistent.
function normalizeStoreId(storeId: string): string {
  return storeId.startsWith("store_") ? storeId.slice("store_".length) : storeId;
}

// Defense-in-depth the SDK itself does not provide (see the module
// comment's "R1 remediation" note above): when `token` is supplied —
// this adapter's only auth path — @vercel/blob derives the real target
// store from the token and never consults `options.storeId` at all.
// Without this check, a config like `{ storeId: CORRECT_DATAHUB_STORE,
// token: TOKEN_FOR_SOME_OTHER_STORE }` would construct successfully
// today and silently target the wrong store on every call. This
// function verifies the caller-supplied storeId actually matches what
// the token itself encodes, and fails closed — throws a plain
// configuration Error — on any mismatch, or on a token so malformed
// that no store id segment can be recovered at all. The token value
// itself is never included in a thrown message; only the (non-secret)
// store id segments are, when useful for debugging.
function verifyTokenStoreIdConsistency(storeId: string, token: string): void {
  const tokenStoreId = extractTokenStoreId(token);
  if (tokenStoreId.length === 0) {
    throw new Error(
      "createVercelBlobFileStore: the supplied token is not a recognizable Vercel Blob " +
        "read-write token (no store id segment could be extracted from it). Refusing to " +
        "construct rather than risk targeting an unintended store."
    );
  }
  if (normalizeStoreId(storeId) !== tokenStoreId) {
    throw new Error(
      `createVercelBlobFileStore: configured storeId "${storeId}" does not match the store id ` +
        `encoded in the supplied token ("${tokenStoreId}"). Refusing to construct rather than ` +
        "risk targeting the wrong Blob store."
    );
  }
}

// Narrow, documented exception to "prefer typed errors over message
// matching" (see module comment above) — the installed SDK has no
// dedicated conflict error class. Checks the exact base BlobError
// class (not a subclass such as BlobFileTooLargeError, which also
// happens to be `instanceof BlobError`) so an unrelated BlobError
// subtype can never be misread as a conflict.
function isPutConflict(err: unknown): boolean {
  return (
    err instanceof BlobError &&
    Object.getPrototypeOf(err) === BlobError.prototype &&
    /already exists/i.test(err.message)
  );
}

function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function createVercelBlobFileStore(config: VercelBlobFileStoreConfig): RawFileStore {
  const storeId = requireNonEmptyString("storeId", config?.storeId);
  const token = requireNonEmptyString("token", config?.token);
  verifyTokenStoreIdConsistency(storeId, token);

  // Defined once and used by both the public head() method and get()'s
  // internal HEAD-before-GET precheck, deliberately as a plain closure
  // rather than via `this.head(...)` — the returned RawFileStore is a
  // plain object literal, and a `this`-based call would break if a
  // caller ever destructures a method off it (e.g. `const { get } =
  // store`), which is a plausible calling pattern this module has no
  // control over.
  async function headInternal(key: string): Promise<RawFileMetadata | null> {
    validateStorageKey(key);

    let result;
    try {
      // head()'s options are BlobCommandOptions (token/oidcToken/
      // storeId/abortSignal only) — the installed SDK's head() does
      // not accept or require an `access` option at all, unlike
      // get(). Confirmed from node_modules/@vercel/blob/dist/index.d.ts.
      result = await blobHead(key, { storeId, token });
    } catch (err) {
      if (err instanceof BlobNotFoundError) return null;
      throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to read metadata for key "${key}".`, err);
    }

    if (!Number.isSafeInteger(result.size) || result.size < 0) {
      throw new RawFileStoreError(
        "PROVIDER_FAILURE",
        `Provider returned invalid size metadata for key "${key}".`
      );
    }

    return {
      provider: VERCEL_BLOB_PRIVATE_PROVIDER,
      size: result.size,
      contentType: result.contentType || undefined,
      etag: result.etag || undefined,
    };
  }

  return {
    provider: VERCEL_BLOB_PRIVATE_PROVIDER,

    async put(
      key: string,
      body: Uint8Array,
      opts: { contentType?: string } = {}
    ): Promise<RawFilePutResult> {
      validateStorageKey(key);
      const contentType = validateContentType(opts.contentType);

      // The installed SDK's PutBody type union (string | Readable |
      // Buffer | Blob | ArrayBuffer | ReadableStream | File) does not
      // include a plain Uint8Array — a genuine typings discrepancy
      // found during implementation-time SDK verification. Buffer.from
      // here copies into a real Buffer (a Uint8Array subclass the SDK
      // does accept); RawFileStore's own scope note already documents
      // put() as a non-hot-path, test-fixture-seeding operation, so
      // this copy is not a performance concern.
      const providerBody = Buffer.from(body);

      let result;
      try {
        result = await blobPut(key, providerBody, {
          access: "private",
          allowOverwrite: false,
          addRandomSuffix: false,
          contentType,
          storeId,
          token,
        });
      } catch (err) {
        if (isPutConflict(err)) {
          throw new RawFileStoreError("ALREADY_EXISTS", `An object already exists at key "${key}".`, err);
        }
        throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to put object at key "${key}".`, err);
      }

      if (result.pathname !== key) {
        throw new RawFileStoreError(
          "PROVIDER_FAILURE",
          `Provider returned pathname "${result.pathname}" for requested key "${key}".`
        );
      }

      return {
        provider: VERCEL_BLOB_PRIVATE_PROVIDER,
        key,
        size: body.byteLength,
        contentType: result.contentType || undefined,
        etag: result.etag || undefined,
      };
    },

    async head(key: string): Promise<RawFileMetadata | null> {
      return headInternal(key);
    },

    async get(
      key: string,
      opts: RawFileGetOptions = {}
    ): Promise<{ metadata: RawFileMetadata; body: Uint8Array }> {
      validateStorageKey(key);
      const maxBytes = validateMaxBytes(opts.maxBytes);

      // HEAD-before-GET precheck (mandatory — see the ADR and the
      // 5A.2F directive's step-by-step GET sequence): a declared size
      // above maxBytes must reject BEFORE any body stream is opened.
      const metadata = await headInternal(key);
      if (metadata === null) {
        throw new RawFileStoreError("NOT_FOUND", `No object exists at key "${key}".`);
      }
      if (maxBytes !== undefined && metadata.size > maxBytes) {
        throw new RawFileStoreError(
          "SIZE_LIMIT",
          `Object at key "${key}" is ${metadata.size} bytes, exceeding the ${maxBytes}-byte limit.`
        );
      }

      let getResult;
      try {
        getResult = await blobGet(key, { access: "private", storeId, token });
      } catch (err) {
        throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to read object at key "${key}".`, err);
      }

      // get() is asymmetric with head(): it resolves to null for a
      // missing object rather than throwing. HEAD already succeeded
      // above, so this is a genuine race (object deleted between HEAD
      // and GET) — still classified NOT_FOUND, never a generic
      // PROVIDER_FAILURE, per the directive's explicit requirement.
      if (getResult === null) {
        throw new RawFileStoreError(
          "NOT_FOUND",
          `No object exists at key "${key}" (removed after its metadata was read).`
        );
      }
      if (getResult.stream === null) {
        // statusCode 304 shape — unreachable in practice since this
        // adapter never passes ifNoneMatch, but the discriminated
        // union makes stream nullable at the type level, so a defensive
        // fail-closed branch is required for type soundness.
        throw new RawFileStoreError("PROVIDER_FAILURE", `Provider returned no content stream for key "${key}".`);
      }

      // Declared-etag consistency: both HEAD and GET metadata carry an
      // etag in the installed SDK's types, so comparing them costs
      // nothing extra and needs no contract expansion. Only compared
      // when both are present — this is additional hardening, not a
      // new required field.
      if (metadata.etag && getResult.blob.etag && metadata.etag !== getResult.blob.etag) {
        throw new RawFileStoreError(
          "PROVIDER_FAILURE",
          `Object at key "${key}" etag changed between HEAD and GET.`
        );
      }

      const reader = getResult.stream.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (maxBytes !== undefined && total > maxBytes) {
            try {
              await reader.cancel();
            } catch {
              // A cancellation failure must never mask the real
              // SIZE_LIMIT violation below — best-effort only.
            }
            throw new RawFileStoreError(
              "SIZE_LIMIT",
              `Object at key "${key}" exceeded the ${maxBytes}-byte limit while streaming.`
            );
          }
          chunks.push(value);
        }
      } catch (err) {
        if (err instanceof RawFileStoreError) throw err;
        throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to read stream for key "${key}".`, err);
      }

      const body = concatChunks(chunks, total);
      if (body.byteLength !== metadata.size) {
        throw new RawFileStoreError(
          "PROVIDER_FAILURE",
          `Object at key "${key}" actual size ${body.byteLength} does not match declared size ${metadata.size}.`
        );
      }

      return { metadata, body };
    },

    async delete(key: string): Promise<void> {
      validateStorageKey(key);
      try {
        await blobDel(key, { storeId, token });
      } catch (err) {
        // del() is documented as idempotent on a missing object; this
        // catch is defense-in-depth in case a future/actual server
        // response ever does surface BlobNotFoundError here — either
        // way, a missing object is success, never PROVIDER_FAILURE.
        if (err instanceof BlobNotFoundError) return;
        throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to delete key "${key}".`, err);
      }
    },
  };
}
