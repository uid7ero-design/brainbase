import { createVercelBlobFileStore } from "../storage/vercelBlobFileStore";
import type { RawFileStore } from "../storage/rawFileStore";

// Data Hub 5A.2G.1 — the ONLY runtime code path anywhere in the Data Hub
// codebase that reads process.env.DATAHUB_BLOB_STORE_ID /
// process.env.DATAHUB_BLOB_READ_WRITE_TOKEN.
//
// Resolves exactly one {storeId, token} credential pair, lazily on first
// use and memoized thereafter, and hands that SAME pair to both (A) the
// RawFileStore adapter (via createVercelBlobFileStore) and (B) the
// direct-upload token signer (directUploadAuth.ts) — never two
// independent resolutions of the same two env vars, which could
// theoretically observe different values if the process environment were
// ever mutated between two separate reads.
//
// FAILS CLOSED: missing or invalid config throws a clear,
// CONFIGURATION_ERROR-mappable error. This deliberately does NOT copy
// lib/resendClient.ts's fail-OPEN-return-null precedent — that pattern
// exists there because a missing Resend key in Preview should degrade an
// optional feature gracefully, not because it is a generally-correct
// pattern. A Data Hub upload/finalize call with no storage credentials at
// all must never proceed as if storage were simply "off".
//
// No fallback to the ambient BLOB_STORE_ID/BLOB_READ_WRITE_TOKEN env vars
// (Events' own store), no fallback to any other Blob store. The token
// value itself is never logged or included in any thrown error message.
//
// Testability: createImportBatchStorage() accepts an optional injected
// {storeId, token} config parameter that, when supplied, entirely bypasses
// the memoized env-resolution path — this is the ONLY seam intended for
// tests. There is deliberately no exported "reset the cache" function:
// real application code could accidentally call it, silently invalidating
// a config that should stay stable for the life of the process.

export interface DataHubBlobCredentials {
  storeId: string;
  token: string;
}

export class DataHubConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataHubConfigurationError";
  }
}

let memoizedCredentials: DataHubBlobCredentials | undefined;

function resolveCredentialsFromEnv(): DataHubBlobCredentials {
  const storeId = process.env.DATAHUB_BLOB_STORE_ID;
  const token = process.env.DATAHUB_BLOB_READ_WRITE_TOKEN;

  if (typeof storeId !== "string" || storeId.trim().length === 0) {
    throw new DataHubConfigurationError(
      "Data Hub Blob storage is not configured: DATAHUB_BLOB_STORE_ID is missing or empty. " +
        "This service never falls back to any other Blob store's configuration."
    );
  }
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new DataHubConfigurationError(
      "Data Hub Blob storage is not configured: DATAHUB_BLOB_READ_WRITE_TOKEN is missing or empty. " +
        "This service never falls back to any other Blob store's configuration."
    );
  }
  return { storeId, token };
}

/**
 * Resolves (and memoizes) the single Data Hub Blob credential pair. Pass
 * `override` only from a test — real application code must always call
 * this with no arguments so it observes the one memoized, env-resolved
 * pair every other caller in the process also observes.
 */
function resolveCredentials(override?: DataHubBlobCredentials): DataHubBlobCredentials {
  if (override) return override;
  if (memoizedCredentials) return memoizedCredentials;
  memoizedCredentials = resolveCredentialsFromEnv();
  return memoizedCredentials;
}

/**
 * Constructs the Data Hub RawFileStore adapter, using the single resolved
 * {storeId, token} pair. Throws DataHubConfigurationError (fail-closed) if
 * that pair cannot be resolved. `override` exists solely for tests — see
 * the module header comment.
 */
export function createImportBatchStorage(override?: DataHubBlobCredentials): RawFileStore {
  const credentials = resolveCredentials(override);
  return createVercelBlobFileStore(credentials);
}

/**
 * Resolves the single {storeId, token} pair used by BOTH the storage
 * adapter above and the direct-upload token signer (directUploadAuth.ts) —
 * exported so directUploadAuth.ts's caller can obtain the exact same pair
 * without a second, independent env resolution. `override` exists solely
 * for tests.
 */
export function resolveImportBatchBlobCredentials(
  override?: DataHubBlobCredentials
): DataHubBlobCredentials {
  return resolveCredentials(override);
}
