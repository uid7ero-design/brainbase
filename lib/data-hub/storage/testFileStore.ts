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
  validateContentType,
  MAX_CONTENT_TYPE_LENGTH,
} from "./rawFileStore";

// Data Hub filesystem-backed RawFileStore — TEST-ONLY reference
// implementation (Phase 5A.2E-R1 remediation; hardened further in
// 5A.2E-R2). This is NOT a candidate Production storage adapter: it
// exists purely to exercise real I/O and real concurrency/race behavior
// that InMemoryFileStore's Map cannot meaningfully simulate (a Map's "no
// overwrite" is trivially true by construction — it never proves
// anything about a genuine filesystem race). Never wire this into
// application code; it fails loudly if constructed while running on
// Vercel (see the constructor guard below).
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
//   5A.2E-R2 did not touch this mechanism — it was independently
//   re-verified during R2 review, including a fresh, independently-run
//   reproduction of the rejected rename() design's exact failure mode.
//
//   Property B (no partial visibility): the final key's path literally
//   does not exist as a directory entry AT ALL until the link() call
//   succeeds — and by the time link() is attempted, the temp file it
//   points at is already 100% written and closed. There is no window in
//   which a reader can observe the final path with partial content,
//   because the final path has exactly two states: absent, or complete.
//   This is proven, not merely asserted, by a concurrent
//   writer-vs-poller behavioral test in the shared contract suite. That
//   test's overlap guarantee relies on a real wall-clock size
//   differential (a 200 KB write vs. a single read) rather than an
//   explicit deterministic barrier — documented honestly as a real, if
//   very reliable in practice, limitation (5A.2E-R2 review, Section 18:
//   not addressed with a production-code test hook, since doing so would
//   expand the architecture for a MINOR finding).
//
// ON-DISK FORMAT: each object is one file: a 4-byte little-endian uint32
// giving the JSON header's byte length, followed by that many bytes of
// JSON (`{ "size": number, "contentType"?: string }`), followed
// immediately by the raw content bytes. Bundling metadata and content
// into a single file written by a single publish step means there is no
// separate metadata file that could exist out of sync with the content
// file — one atomic publish, one consistent unit. This framing exists
// only for this test-only, process-lifetime-scoped store (5A.2E-R2
// review: an in-memory metadata index would have avoided the parsing
// surface below entirely, but the format is already committed and
// hardening it in place — rather than redesigning it — is the narrowly
// scoped fix this remediation performs; see the ADR for the full
// discussion).
//
// FRAMING HARDENING (5A.2E-R2): the original candidate trusted the
// on-disk 4-byte header-length prefix directly as a Buffer.alloc() size
// with no upper bound — independently reproduced during R2 review as a
// real, if test-only-scoped, resource-exhaustion defect (a corrupted
// 4-byte file claiming a ~2 GiB header caused an immediate ~2 GiB
// allocation attempt with zero validation). Every read path now:
//   1. bounds the declared header length against MAX_HEADER_BYTES
//      BEFORE any allocation sized from it;
//   2. cross-checks the declared header length (and, for get(), the
//      declared content length) against the file's REAL, OS-reported
//      size (via fstat) before trusting either value for an allocation
//      or believing a read fully succeeded;
//   3. validates the parsed header's shape at runtime (JSON.parse alone
//      proves only that the bytes were valid JSON, never that they match
//      the FileHeader type — a raw `as FileHeader` cast was the original
//      candidate's gap);
//   4. requires exact declared/actual content-length equality for
//      get() — never silently returns a truncated body, never silently
//      accepts trailing garbage past the declared length.
// Every violation of the above is a MALFORMED/CORRUPT FRAMED OBJECT and
// normalizes to PROVIDER_FAILURE, never a raw SyntaxError, RangeError,
// or Node ErrnoException.

const HEADER_LENGTH_BYTES = 4;

// The framed header's schema is small and fixed ({ size: number,
// contentType?: string up to MAX_CONTENT_TYPE_LENGTH chars }). Worst
// case: `{"size":9007199254740991,"contentType":"` + a maximally
// backslash/quote-escaped MAX_CONTENT_TYPE_LENGTH-character string
// (up to ~2x its raw length once escaped) + `"}"` — comfortably under
// 1 KiB. 2048 bytes leaves generous headroom without being an arbitrary
// huge ceiling; any declared length above this is treated as corrupt
// framing, not a legitimate object.
const MAX_HEADER_BYTES = 2048;

interface FileHeader {
  size: number;
  contentType?: string;
}

interface ReadHeaderResult {
  header: FileHeader;
  /** The ACTUAL validated on-disk header byte length (from the length
   * prefix, after bounds-checking) — never recomputed via
   * JSON.stringify(header) re-serialization. 5A.2E-R2: the original
   * candidate recomputed this fragile way; reusing the real encoded
   * length here is the fix. */
  headerLength: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Runtime shape validation for a JSON.parse() result — JSON.parse alone
// only proves the bytes were valid JSON, never that they match
// FileHeader (5A.2E-R2: the original candidate performed a bare
// `as FileHeader` cast with no runtime check at all). Throws a plain
// Error (never RawFileStoreError) on any violation; both head() and
// get()'s surrounding catch blocks already normalize any non-
// RawFileStoreError exception to PROVIDER_FAILURE, so this deliberately
// does not duplicate that normalization here.
function validateParsedHeader(parsed: unknown): FileHeader {
  if (!isPlainObject(parsed)) {
    throw new Error("Framed object header is not a JSON object.");
  }
  const { size, contentType } = parsed;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw new Error(`Framed object header "size" must be a non-negative safe integer; received ${String(size)}.`);
  }
  if (contentType !== undefined) {
    if (typeof contentType !== "string" || contentType.length > MAX_CONTENT_TYPE_LENGTH) {
      throw new Error("Framed object header \"contentType\" is missing, of the wrong type, or too long.");
    }
  }
  return { size, contentType };
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
    // Lexical containment only (5A.2E-R2 wording correction): this
    // re-verifies that the STRING path composed from an already-
    // validated key (no '..', no absolute form, no drive letter, no
    // backslash) cannot lexically resolve outside root. It does NOT
    // resolve on-disk symlinks (no fs.realpath call) and therefore does
    // NOT defend against a symlink placed inside root by another
    // process/test before this store touches that path — that class of
    // hostile-local-machine precondition is explicitly outside this
    // test-only adapter's threat model (5A.2E-R2 review, Section 14: a
    // MINOR finding, deliberately not expanded into realpath/sandbox-
    // grade hardening here). Ordinary test use — a fresh, empty root this
    // store itself populates — never introduces a symlink, since this
    // module never creates one.
    const resolved = path.resolve(this.root, ...key.split("/"));
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (resolved !== this.root && !resolved.startsWith(rootWithSep)) {
      throw new RawFileStoreError("INVALID_KEY", `Storage key "${key}" resolves outside the store root.`);
    }
    return resolved;
  }

  private async ensureParentDir(filePath: string, key: string): Promise<void> {
    // 5A.2E-R2: was previously unguarded — a permission-denied or other
    // mkdir failure propagated as a raw Node error straight out of
    // put(), never normalized.
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
    } catch (err) {
      throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to prepare storage location for key "${key}".`, err);
    }
  }

  private static encodeObject(body: Uint8Array, contentType: string | undefined): Buffer {
    const header: FileHeader = { size: body.byteLength, contentType };
    const headerJson = Buffer.from(JSON.stringify(header), "utf8");
    const lengthPrefix = Buffer.alloc(HEADER_LENGTH_BYTES);
    lengthPrefix.writeUInt32LE(headerJson.byteLength, 0);
    return Buffer.concat([lengthPrefix, headerJson, Buffer.from(body)]);
  }

  // Reads and validates the framed header only — never touches content
  // bytes. `fileSize` (from a real fstat the caller already performed)
  // is required so the declared header length can be cross-checked
  // against actual on-disk bytes before being trusted for allocation
  // (5A.2E-R2). Throws a plain Error (never RawFileStoreError) for any
  // framing violation — normalized by every caller's own catch.
  private static async readHeader(handle: fs.FileHandle, fileSize: number): Promise<ReadHeaderResult> {
    if (fileSize < HEADER_LENGTH_BYTES) {
      throw new Error(`Framed object is truncated: ${fileSize} bytes is smaller than the length prefix itself.`);
    }
    const lengthPrefix = Buffer.alloc(HEADER_LENGTH_BYTES);
    const { bytesRead: prefixBytesRead } = await handle.read(lengthPrefix, 0, HEADER_LENGTH_BYTES, 0);
    if (prefixBytesRead !== HEADER_LENGTH_BYTES) {
      throw new Error("Framed object is truncated: could not read the full length prefix.");
    }
    const headerLength = lengthPrefix.readUInt32LE(0);

    // Bound BEFORE allocation — the entire point of this fix. Neither
    // check below ever calls Buffer.alloc(headerLength) first.
    if (headerLength <= 0) {
      throw new Error(`Framed object header length is invalid: ${headerLength}.`);
    }
    if (headerLength > MAX_HEADER_BYTES) {
      throw new Error(`Framed object header length ${headerLength} exceeds the ${MAX_HEADER_BYTES}-byte maximum.`);
    }
    // Cross-check the declared length against the file's REAL size
    // (from fstat, not from anything embedded in the file itself) before
    // treating it as valid — closes the "header claims bytes not present
    // in the file" case (F3) without ever allocating for the claim.
    if (fileSize < HEADER_LENGTH_BYTES + headerLength) {
      throw new Error(
        `Framed object header claims ${headerLength} bytes, but only ${fileSize - HEADER_LENGTH_BYTES} are present.`
      );
    }

    const headerBuf = Buffer.alloc(headerLength);
    const { bytesRead: headerBytesRead } = await handle.read(headerBuf, 0, headerLength, HEADER_LENGTH_BYTES);
    if (headerBytesRead !== headerLength) {
      throw new Error("Framed object is truncated: could not read the full declared header.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(headerBuf.toString("utf8"));
    } catch (err) {
      throw new Error("Framed object header is not valid JSON.");
    }
    const header = validateParsedHeader(parsed);
    return { header, headerLength };
  }

  async put(
    key: string,
    body: Uint8Array,
    opts: { contentType?: string } = {}
  ): Promise<RawFilePutResult> {
    const contentType = validateContentType(opts.contentType);
    const finalPath = this.resolvePath(key);
    await this.ensureParentDir(finalPath, key);

    const tempPath = `${finalPath}.tmp-${randomBytes(16).toString("hex")}`;
    const framed = TestFileStore.encodeObject(body, contentType);

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

    return { provider: this.provider, key, size: body.byteLength, contentType };
  }

  async head(key: string): Promise<RawFileMetadata | null> {
    const finalPath = this.resolvePath(key);
    let handle: fs.FileHandle;
    try {
      handle = await fs.open(finalPath, "r");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to open key "${key}".`, err);
    }

    let result: RawFileMetadata;
    try {
      const stat = await handle.stat();
      const { header } = await TestFileStore.readHeader(handle, stat.size);
      result = { provider: this.provider, size: header.size, contentType: header.contentType };
    } catch (err) {
      // Primary operation failed — close best-effort and let the
      // primary error win; a close() failure must never mask it
      // (5A.2E-R2, Section 10.B precedence requirement).
      await handle.close().catch(() => {});
      if (err instanceof RawFileStoreError) throw err;
      throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to read metadata for key "${key}".`, err);
    }

    // Primary operation succeeded — a close() failure here means the
    // operation did not complete safely and must not be silently
    // swallowed into a false success (5A.2E-R2, Section 10.B).
    try {
      await handle.close();
    } catch (err) {
      throw new RawFileStoreError(
        "PROVIDER_FAILURE",
        `Failed to close handle for key "${key}" after reading metadata.`,
        err
      );
    }
    return result;
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

    let result: { metadata: RawFileMetadata; body: Uint8Array };
    try {
      const stat = await handle.stat();
      const { header, headerLength } = await TestFileStore.readHeader(handle, stat.size);

      // Precedence (5A.2E-R2, Section 7): a genuine size-ceiling
      // violation is SIZE_LIMIT even if the object is otherwise
      // perfectly well-formed. This check runs BEFORE the body-framing
      // consistency check below, so corruption never masquerades as
      // SIZE_LIMIT and a real size violation is never masked as
      // PROVIDER_FAILURE.
      if (maxBytes !== undefined && header.size > maxBytes) {
        throw new RawFileStoreError(
          "SIZE_LIMIT",
          `Object at key "${key}" is ${header.size} bytes, exceeding the ${maxBytes}-byte limit.`
        );
      }

      // Strict framing (5A.2E-R2): the file's REAL size (from fstat, not
      // from anything the file claims about itself) must equal exactly
      // header-prefix + header + declared content length — no fewer
      // bytes (a truncated object) and no extra trailing bytes (hidden
      // data). Either violation is corrupt framing, not a legitimate
      // object, regardless of maxBytes.
      const contentStart = HEADER_LENGTH_BYTES + headerLength;
      const expectedTotalSize = contentStart + header.size;
      if (stat.size !== expectedTotalSize) {
        throw new Error(
          `Framed object body length is inconsistent: declared ${header.size} content bytes, but the file is ` +
            `${stat.size - contentStart} bytes past the header.`
        );
      }

      // header.size is now corroborated by an independent OS-reported
      // file size (not merely trusted from the file's own embedded
      // declaration), and has already been confirmed <= maxBytes (or no
      // ceiling was supplied) — so allocating exactly header.size bytes
      // here is bounded and safe, never sized from an unverified claim.
      const buffer = Buffer.alloc(header.size);
      const { bytesRead } = await handle.read(buffer, 0, header.size, contentStart);
      if (bytesRead !== header.size) {
        // Belt-and-suspenders: a stat/read race (e.g. concurrent
        // truncation) that the fstat check above could not catch.
        throw new Error(`Expected to read ${header.size} content bytes but actually read ${bytesRead}.`);
      }

      const body = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      result = {
        metadata: { provider: this.provider, size: header.size, contentType: header.contentType },
        body,
      };
    } catch (err) {
      await handle.close().catch(() => {});
      // Errors deliberately thrown above (SIZE_LIMIT) are already
      // RawFileStoreError and must pass through unchanged; anything else
      // — e.g. a raw Node ErrnoException such as EISDIR, which surfaces
      // only once a read is attempted on a directory handle, not at
      // open() time, or a malformed/corrupt-framing Error thrown by
      // readHeader/validateParsedHeader/the consistency check above —
      // must be normalized, never leaked to the caller.
      if (err instanceof RawFileStoreError) throw err;
      throw new RawFileStoreError("PROVIDER_FAILURE", `Failed to read object at key "${key}".`, err);
    }

    try {
      await handle.close();
    } catch (err) {
      throw new RawFileStoreError(
        "PROVIDER_FAILURE",
        `Failed to close handle for key "${key}" after reading its content.`,
        err
      );
    }
    return result;
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
