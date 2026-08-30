import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import {
  RawFileStore,
  RawFileStoreError,
  RawFileMetadata,
  RawFilePutResult,
  RawFileGetOptions,
  validateStorageKey,
  validateMaxBytes,
} from "./rawFileStore";

// Data Hub filesystem-backed RawFileStore — TEST-ONLY reference
// implementation (Phase 5A.2E-R1 remediation). This is NOT a candidate
// Production storage adapter: it exists purely to exercise real I/O and
// real concurrency/race behavior that InMemoryFileStore's Map cannot
// meaningfully simulate (a Map's "no overwrite" is trivially true by
// construction — it never proves anything about a genuine filesystem
// race). Never wire this into application code; it fails loudly if
// constructed while running on Vercel (see the constructor guard below).
//
// PUBLICATION ALGORITHM — why this satisfies both required properties:
//
//   Property A (no silent overwrite race): a plain `rename(tmp, final)`
//   was considered and REJECTED. POSIX rename() silently REPLACES an
//   existing destination — it is atomic with respect to visibility, but
//   it is NOT exclusive. Two concurrent writers to the same key using
//   rename() would have the second writer's rename silently clobber the
//   first, with no error raised to either caller — exactly the bug an
//   earlier draft of this design (5A.2E-R1 review) caught and rejected.
//
//   Instead: every write is (1) fully assembled and written to a
//   uniquely-named temporary file in the same directory as the final
//   destination, then (2) published by calling fs.link(tempPath,
//   finalPath) — a hard link, not a rename. POSIX (and Windows' NTFS,
//   which Node maps to CreateHardLink) specifies link() as failing with
//   EEXIST if the destination name already exists, and as atomic: for any
//   set of concurrent link() calls targeting the same destination name,
//   the filesystem guarantees exactly one succeeds and every other one
//   fails. This is the same "atomic exclusive publish via hard link"
//   technique long used by other file-based systems that need this exact
//   guarantee (e.g. Maildir-style safe delivery). The loser unlinks its
//   own orphaned temp file and reports ALREADY_EXISTS; the winner unlinks
//   its now-redundant temp directory entry (the data survives — link()
//   only adds a second name for the same inode, it does not copy).
//
//   Property B (no partial visibility): the final key's path literally
//   does not exist as a directory entry AT ALL until the link() call
//   succeeds — and by the time link() is attempted, the temp file it
//   points at is already 100% written and closed. There is no window in
//   which a reader can observe the final path with partial content,
//   because the final path has exactly two states: absent, or complete.
//   This is proven, not merely asserted, by a concurrent
//   writer-vs-poller behavioral test in the shared contract suite.
//
// ON-DISK FORMAT: each object is one file: a 4-byte little-endian
// uint32 giving the JSON header's byte length, followed by that many
// bytes of JSON (`{ "size": number, "contentType"?: string }`), followed
// immediately by the raw content bytes. Bundling metadata and content into
// a single file written by a single publish step means there is no
// separate metadata file that could exist out of sync with the content
// file — one atomic publish, one consistent unit.

const HEADER_LENGTH_BYTES = 4;

interface FileHeader {
  size: number;
  contentType?: string;
}

export class TestFileStore implements RawFileStore {
  readonly provider = "test-fs";
  private readonly root: string;

  constructor(root: string) {
    if (process.env.VERCEL) {
      throw new Error(
        "TestFileStore must never be constructed in a Vercel runtime. It is a test-only reference " +
          "implementation, not a Production storage adapter."
      );
    }
    if (typeof root !== "string" || root.length === 0) {
      throw new Error("TestFileStore requires an explicit root directory.");
    }
    this.root = path.resolve(root);
  }

  private resolvePath(key: string): string {
    validateStorageKey(key);
    // Defense-in-depth beyond validateStorageKey's own grammar check: the
    // resolved path must still land strictly inside root. path.join with
    // an already-validated (no '..', no absolute, no drive letter, no
    // backslash) key cannot escape root, but re-verifying containment
    // costs nothing and protects against a future change to the key
    // grammar silently reopening a traversal path.
    const resolved = path.resolve(this.root, ...key.split("/"));
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (resolved !== this.root && !resolved.startsWith(rootWithSep)) {
      throw new RawFileStoreError("INVALID_KEY", `Storage key "${key}" resolves outside the store root.`);
    }
    return resolved;
  }

  private async ensureParentDir(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }

  private static encodeObject(body: Uint8Array, contentType: string | undefined): Buffer {
    const header: FileHeader = { size: body.byteLength, contentType };
    const headerJson = Buffer.from(JSON.stringify(header), "utf8");
    const lengthPrefix = Buffer.alloc(HEADER_LENGTH_BYTES);
    lengthPrefix.writeUInt32LE(headerJson.byteLength, 0);
    return Buffer.concat([lengthPrefix, headerJson, Buffer.from(body)]);
  }

  private static async readHeader(handle: fs.FileHandle): Promise<FileHeader> {
    const lengthPrefix = Buffer.alloc(HEADER_LENGTH_BYTES);
    await handle.read(lengthPrefix, 0, HEADER_LENGTH_BYTES, 0);
    const headerLength = lengthPrefix.readUInt32LE(0);
    const headerBuf = Buffer.alloc(headerLength);
    await handle.read(headerBuf, 0, headerLength, HEADER_LENGTH_BYTES);
    return JSON.parse(headerBuf.toString("utf8")) as FileHeader;
  }

  async put(
    key: string,
    body: Uint8Array,
    opts: { contentType?: string } = {}
  ): Promise<RawFilePutResult> {
    const finalPath = this.resolvePath(key);
    await this.ensureParentDir(finalPath);

    const tempPath = `${finalPath}.tmp-${randomBytes(16).toString("hex")}`;
    const framed = TestFileStore.encodeObject(body, opts.contentType);

    try {
      await fs.writeFile(tempPath, framed, { flag: "wx" });
    } catch (err) {
      throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to stage write for key "${key}".`, err);
    }

    try {
      await fs.link(tempPath, finalPath);
    } catch (err) {
      await fs.unlink(tempPath).catch(() => {});
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        throw new RawFileStoreError("ALREADY_EXISTS", `An object already exists at key "${key}".`);
      }
      throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to publish object at key "${key}".`, err);
    }

    // Best-effort cleanup of the now-redundant temp directory entry — the
    // published data survives via the link regardless of whether this
    // unlink succeeds.
    await fs.unlink(tempPath).catch(() => {});

    return { provider: this.provider, key, size: body.byteLength, contentType: opts.contentType };
  }

  async head(key: string): Promise<RawFileMetadata | null> {
    const finalPath = this.resolvePath(key);
    let handle: fs.FileHandle;
    try {
      handle = await fs.open(finalPath, "r");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to stat key "${key}".`, err);
    }
    try {
      const header = await TestFileStore.readHeader(handle);
      return { provider: this.provider, size: header.size, contentType: header.contentType };
    } catch (err) {
      throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to read metadata for key "${key}".`, err);
    } finally {
      await handle.close();
    }
  }

  async get(
    key: string,
    opts: RawFileGetOptions = {}
  ): Promise<{ metadata: RawFileMetadata; body: Uint8Array }> {
    const finalPath = this.resolvePath(key);
    const maxBytes = validateMaxBytes(opts.maxBytes);

    let handle: fs.FileHandle;
    try {
      handle = await fs.open(finalPath, "r");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new RawFileStoreError("NOT_FOUND", `No object exists at key "${key}".`);
      }
      throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to open key "${key}".`, err);
    }

    try {
      const header = await TestFileStore.readHeader(handle);

      // Early rejection from metadata, before reading any content bytes —
      // cheap, but not solely trusted (see the hard bound below).
      if (maxBytes !== undefined && header.size > maxBytes) {
        throw new RawFileStoreError(
          "SIZE_LIMIT",
          `Object at key "${key}" is ${header.size} bytes, exceeding the ${maxBytes}-byte limit.`
        );
      }

      // Hard bound while reading: read at most (maxBytes + 1) content
      // bytes so a metadata/content inconsistency can never silently
      // materialize more than the caller's ceiling. If more than maxBytes
      // bytes are actually readable, that is itself a SIZE_LIMIT failure
      // rather than a partial, silently-truncated success.
      const contentStart = HEADER_LENGTH_BYTES + Buffer.byteLength(JSON.stringify(header), "utf8");
      const readCap = maxBytes !== undefined ? maxBytes + 1 : header.size;
      const buffer = Buffer.alloc(readCap);
      const { bytesRead } = await handle.read(buffer, 0, readCap, contentStart);

      if (maxBytes !== undefined && bytesRead > maxBytes) {
        throw new RawFileStoreError(
          "SIZE_LIMIT",
          `Object at key "${key}" exceeded the ${maxBytes}-byte limit while reading.`
        );
      }

      const body = new Uint8Array(buffer.subarray(0, bytesRead));
      return {
        metadata: { provider: this.provider, size: header.size, contentType: header.contentType },
        body,
      };
    } catch (err) {
      // Errors deliberately thrown above (SIZE_LIMIT) are already
      // RawFileStoreError and must pass through unchanged; anything else —
      // e.g. a raw Node ErrnoException such as EISDIR, which surfaces only
      // once a read is attempted on a directory handle, not at open() time
      // — must be normalized, never leaked to the caller.
      if (err instanceof RawFileStoreError) throw err;
      throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to read object at key "${key}".`, err);
    } finally {
      await handle.close();
    }
  }

  async delete(key: string): Promise<void> {
    const finalPath = this.resolvePath(key);
    try {
      await fs.unlink(finalPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to delete key "${key}".`, err);
    }
  }
}
