import {
  RawFileStore,
  RawFileStoreError,
  RawFileMetadata,
  RawFilePutResult,
  RawFileGetOptions,
  validateStorageKey,
  validateMaxBytes,
} from "./rawFileStore";

interface StoredObject {
  bytes: Uint8Array;
  contentType?: string;
}

/**
 * Map-backed RawFileStore. Zero I/O, zero filesystem/network/environment
 * dependence — cannot be accidentally exercised against Production by
 * construction, regardless of where it is wired up. Proves the CONTRACT's
 * logical semantics (no-overwrite, idempotent delete, cross-key isolation)
 * with no I/O flakiness. Does NOT prove real-world atomicity/concurrency
 * races the way TestFileStore does — see that module's own header comment.
 */
export class InMemoryFileStore implements RawFileStore {
  readonly provider = "memory";
  private readonly objects = new Map<string, StoredObject>();

  async put(
    key: string,
    body: Uint8Array,
    opts: { contentType?: string } = {}
  ): Promise<RawFilePutResult> {
    validateStorageKey(key);
    if (this.objects.has(key)) {
      throw new RawFileStoreError("ALREADY_EXISTS", `An object already exists at key "${key}".`);
    }
    // Copy defensively in both directions: the caller's buffer must never
    // be able to mutate stored data after put() returns (a Uint8Array is a
    // view over mutable memory the caller still owns).
    const stored: StoredObject = {
      bytes: body.slice(),
      contentType: opts.contentType,
    };
    this.objects.set(key, stored);
    return {
      provider: this.provider,
      key,
      size: stored.bytes.byteLength,
      contentType: stored.contentType,
    };
  }

  async head(key: string): Promise<RawFileMetadata | null> {
    validateStorageKey(key);
    const stored = this.objects.get(key);
    if (!stored) return null;
    return { provider: this.provider, size: stored.bytes.byteLength, contentType: stored.contentType };
  }

  async get(
    key: string,
    opts: RawFileGetOptions = {}
  ): Promise<{ metadata: RawFileMetadata; body: Uint8Array }> {
    validateStorageKey(key);
    const maxBytes = validateMaxBytes(opts.maxBytes);
    const stored = this.objects.get(key);
    if (!stored) {
      throw new RawFileStoreError("NOT_FOUND", `No object exists at key "${key}".`);
    }
    // Checked against the already-known stored length before ever copying
    // — no partial materialization occurs for an in-memory object anyway,
    // but the check still happens strictly before the copy so the
    // semantics match every other implementation's "reject before
    // materializing more than maxBytes" contract.
    if (maxBytes !== undefined && stored.bytes.byteLength > maxBytes) {
      throw new RawFileStoreError(
        "SIZE_LIMIT",
        `Object at key "${key}" is ${stored.bytes.byteLength} bytes, exceeding the ${maxBytes}-byte limit.`
      );
    }
    return {
      metadata: { provider: this.provider, size: stored.bytes.byteLength, contentType: stored.contentType },
      // Copy so a caller mutating the returned body cannot mutate stored data.
      body: stored.bytes.slice(),
    };
  }

  async delete(key: string): Promise<void> {
    validateStorageKey(key);
    this.objects.delete(key);
  }
}
