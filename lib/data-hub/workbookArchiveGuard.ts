import { crc32 as nativeCrc32 } from "node:zlib";
import * as CRC32 from "crc-32";
import * as yauzl from "yauzl";

// Data Hub 5A.2D — bounded XLSX archive/decompression boundary.
//
// WHY THIS EXISTS: SheetJS's XLSX.read (via the bundled `cfb` ZIP reader)
// eagerly decompresses every entry in a ZIP archive before any of this
// repository's own workbook-level limits ever run, and its pure-JS inflate
// path allocates its output buffer directly from each entry's *declared*
// uncompressed size — with no cap. A small, standards-shaped .xlsx file can
// therefore trigger an arbitrarily large allocation/decompression the
// instant XLSX.read is called, regardless of `sheets`/`bookSheets`/
// `sheetRows` options (verified directly against the installed cfb/xlsx
// source during 5A.2D discovery — those options limit later worksheet
// *materialization*, never ZIP *decompression*). This module is the
// mandatory gate standing between untrusted XLSX bytes and XLSX.read.
//
// DESIGN: yauzl does all real ZIP parsing (central directory, per-entry
// metadata, local-header reads, decompression streams). This module adds
// only the minimum independent structural checks yauzl does not perform or
// does not expose after the fact — see parseEndOfCentralDirectory below —
// and a hard, policy-driven byte/entry-count budget enforced by actually
// streaming and counting every entry's decompressed bytes (never trusting
// a declared size alone). This is deliberately NOT a general ZIP parser or
// decompressor; every byte of actual decompression is done by yauzl/zlib.
//
// INITIAL CONTRACT (intentionally narrow — see the ADR):
// ACCEPT: single-disk, non-ZIP64, STORED/DEFLATE entries, ASCII-safe
//   archive paths, no archive/entry comments, no data descriptors.
// REJECT: ZIP64, data descriptors, encryption, multi-disk, unsupported
//   compression methods, comments, unsafe/ambiguous/colliding names,
//   structurally ambiguous layout (duplicate/overlapping entry ranges,
//   entries overlapping the central directory, trailing/concatenated data).
// This contract may be widened later with evidence; it must never be
// silently broadened.

export interface ArchiveLimits {
  /** Total number of entries the central directory may declare. */
  maxArchiveEntryCount: number;
  /** Per-entry compressed byte size, from the central directory. */
  maxCompressedEntryBytes: number;
  /** Per-entry *declared* uncompressed byte size — checked before any decompression. */
  maxDeclaredEntryUncompressedBytes: number;
  /** Per-entry *actually streamed* uncompressed byte count — checked as bytes arrive. */
  maxActualEntryUncompressedBytes: number;
  /** Sum of every entry's *declared* uncompressed size — checked before any decompression. */
  maxDeclaredAggregateUncompressedBytes: number;
  /** Sum of every entry's *actually streamed* uncompressed byte count — checked as bytes arrive. */
  maxActualAggregateUncompressedBytes: number;
  /** Raw archive-path byte length per entry. */
  maxFilenameBytes: number;
  /** Extra-field byte length per entry (checked independently for the central and local copies). */
  maxExtraFieldBytes: number;
  /** Whole-archive comment byte length. Must be exactly this value (0) to pass. */
  archiveCommentBytes: number;
  /** Per-entry comment byte length. Must be exactly this value (0) to pass. */
  entryCommentBytes: number;
}

// Exact values approved for 5A.2D. All boundaries are inclusive: a value
// equal to a limit passes; limit + 1 fails. See the ADR for the rationale
// behind each — in particular, why compression *ratio* is deliberately not
// one of these (a legitimate, highly-repetitive XLSX can compress at
// extreme ratios while remaining absolutely small; the absolute byte caps
// below are the real, non-false-positive-prone safety boundary).
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxArchiveEntryCount: 1000,
  maxCompressedEntryBytes: 20 * 1024 * 1024,
  maxDeclaredEntryUncompressedBytes: 64 * 1024 * 1024,
  maxActualEntryUncompressedBytes: 64 * 1024 * 1024,
  maxDeclaredAggregateUncompressedBytes: 128 * 1024 * 1024,
  maxActualAggregateUncompressedBytes: 128 * 1024 * 1024,
  maxFilenameBytes: 512,
  maxExtraFieldBytes: 4 * 1024,
  archiveCommentBytes: 0,
  entryCommentBytes: 0,
};

// Deliberately narrower than WorkbookParserErrorCode — this module knows
// nothing about the wider workbook-parser error contract. The caller
// (workbookParser.ts) translates ArchiveGuardError into the public
// WorkbookParserError/WorkbookParserErrorCode contract, adding
// ARCHIVE_LIMIT_EXCEEDED and UNSAFE_ARCHIVE to that union. Kept as a
// standalone type (not imported from workbookParser.ts) so this module has
// zero dependency on the parser and cannot form an import cycle with it.
export type ArchiveGuardErrorCode = "ARCHIVE_LIMIT_EXCEEDED" | "UNSAFE_ARCHIVE" | "MALFORMED_WORKBOOK";

export interface ArchiveGuardErrorDetails {
  limit?: string;
  maximum?: number;
  actual?: number;
  [key: string]: unknown;
}

export class ArchiveGuardError extends Error {
  readonly code: ArchiveGuardErrorCode;
  readonly details?: ArchiveGuardErrorDetails;
  readonly cause?: unknown;

  constructor(code: ArchiveGuardErrorCode, message: string, details?: ArchiveGuardErrorDetails, cause?: unknown) {
    super(message);
    this.name = "ArchiveGuardError";
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer; received ${String(value)}.`);
  }
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer; received ${String(value)}.`);
  }
}

function validateArchiveLimits(limits: ArchiveLimits): void {
  assertPositiveSafeInteger(limits.maxArchiveEntryCount, "maxArchiveEntryCount");
  assertPositiveSafeInteger(limits.maxCompressedEntryBytes, "maxCompressedEntryBytes");
  assertPositiveSafeInteger(limits.maxDeclaredEntryUncompressedBytes, "maxDeclaredEntryUncompressedBytes");
  assertPositiveSafeInteger(limits.maxActualEntryUncompressedBytes, "maxActualEntryUncompressedBytes");
  assertPositiveSafeInteger(limits.maxDeclaredAggregateUncompressedBytes, "maxDeclaredAggregateUncompressedBytes");
  assertPositiveSafeInteger(limits.maxActualAggregateUncompressedBytes, "maxActualAggregateUncompressedBytes");
  assertPositiveSafeInteger(limits.maxFilenameBytes, "maxFilenameBytes");
  assertPositiveSafeInteger(limits.maxExtraFieldBytes, "maxExtraFieldBytes");
  assertNonNegativeSafeInteger(limits.archiveCommentBytes, "archiveCommentBytes");
  assertNonNegativeSafeInteger(limits.entryCommentBytes, "entryCommentBytes");
}

// ---------------------------------------------------------------------------
// Incremental CRC-32. Node 20.15+/22.2+ expose a native zlib.crc32(data,
// previous) that accepts the running CRC as a seed for the next chunk —
// exactly the mechanism yauzl itself uses internally (for its own filename
// CRC check) when available, falling back to the same crc-32 npm package
// this module also declares directly (already present transitively via
// xlsx -> cfb -> crc-32; declared here explicitly rather than relied upon
// implicitly, per the requirement that transitive presence is not itself
// an entitlement to depend on a package). Neither call ever buffers
// anything beyond the current chunk.
// ---------------------------------------------------------------------------

function crc32Step(chunk: Buffer, previous: number): number {
  if (typeof nativeCrc32 === "function") {
    return nativeCrc32(chunk, previous) >>> 0;
  }
  return (CRC32.buf(chunk, previous) as number) >>> 0;
}

// ---------------------------------------------------------------------------
// Minimal, narrowly-scoped end-of-central-directory inspection.
//
// This is NOT a general ZIP parser: it reads exactly one fixed-size,
// fixed-position 22-byte record (plus, when present, the 20 bytes
// immediately before it, to detect a ZIP64 locator). It exists only
// because yauzl does not expose these facts about its own interpretation
// after a successful open: `centralDirectoryOffset` is consumed and
// mutated internally as entries are read (see yauzl's `readEntryCursor`),
// and yauzl performs no whole-archive-comment-length *policy* (only an
// internal self-consistency check that a nonzero comment's declared length
// matches the remaining buffer).
//
// This mirrors yauzl's own bounded backward search for the EOCD signature
// (necessary because a comment of unknown length can precede it) so that
// this module's independent interpretation is computed the same way yauzl
// computes its own — the two are meant to be compared afterward, not to
// disagree by construction over search strategy. A truly truncated/corrupt
// archive (no EOCD signature anywhere in the bounded window) is
// MALFORMED_WORKBOOK; a syntactically valid EOCD whose comment length is
// internally inconsistent with the actual trailing bytes is also
// MALFORMED_WORKBOOK (the metadata cannot be trusted at all); a
// syntactically valid, internally-consistent EOCD with a genuine nonzero
// comment is a deliberate policy rejection, UNSAFE_ARCHIVE — this module's
// zero-comment contract, not a structural failure. Any trailing/
// concatenated data after a real archive necessarily makes the *declared*
// comment length disagree with the *actual* trailing byte count, so it is
// naturally caught by the same consistency check without separate logic.
// ---------------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_LOCATOR_SIZE = 20;
const ZIP64_EXTRA_FIELD_ID = 0x0001;

// General-purpose bit flags this module explicitly inspects.
const GPBF_ENCRYPTED = 0x0001;
const GPBF_DATA_DESCRIPTOR = 0x0008;
const GPBF_STRONG_ENCRYPTION = 0x0040;

interface EndOfCentralDirectory {
  diskNumber: number;
  entryCount: number;
  centralDirectoryOffset: number;
  commentLength: number;
}

function toNodeBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function parseEndOfCentralDirectory(buffer: Buffer): EndOfCentralDirectory {
  if (buffer.length < EOCD_SIZE) {
    throw new ArchiveGuardError("MALFORMED_WORKBOOK", "The archive is too small to contain a ZIP end-of-central-directory record.");
  }

  const searchWindowStart = Math.max(0, buffer.length - EOCD_SIZE - MAX_COMMENT_SIZE);
  let eocdOffset = -1;
  for (let i = buffer.length - EOCD_SIZE; i >= searchWindowStart; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new ArchiveGuardError(
      "MALFORMED_WORKBOOK",
      "End-of-central-directory record signature not found; the archive may be truncated or corrupt."
    );
  }

  const commentLength = buffer.readUInt16LE(eocdOffset + 20);
  const actualTrailingBytes = buffer.length - (eocdOffset + EOCD_SIZE);
  if (commentLength !== actualTrailingBytes) {
    throw new ArchiveGuardError(
      "MALFORMED_WORKBOOK",
      "The archive's declared comment length does not match its actual trailing byte count."
    );
  }
  if (commentLength !== 0) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Archive comments are not accepted.");
  }

  // commentLength === 0 now guarantees eocdOffset === buffer.length - EOCD_SIZE.
  if (eocdOffset >= ZIP64_EOCD_LOCATOR_SIZE) {
    const locatorSignature = buffer.readUInt32LE(eocdOffset - ZIP64_EOCD_LOCATOR_SIZE);
    if (locatorSignature === ZIP64_EOCD_LOCATOR_SIGNATURE) {
      throw new ArchiveGuardError("UNSAFE_ARCHIVE", "ZIP64 archives are not accepted by the initial archive contract.");
    }
  }

  return {
    diskNumber: buffer.readUInt16LE(eocdOffset + 4),
    entryCount: buffer.readUInt16LE(eocdOffset + 10),
    centralDirectoryOffset: buffer.readUInt32LE(eocdOffset + 16),
    commentLength,
  };
}

// ---------------------------------------------------------------------------
// Per-entry declared-metadata checks (Section 8 of the approved contract):
// everything checkable from the central-directory Entry alone, before any
// I/O or decompression. Cheapest checks first.
// ---------------------------------------------------------------------------

function assertDeclaredEntry(entry: yauzl.Entry, limits: ArchiveLimits): void {
  if (entry.generalPurposeBitFlag & GPBF_ENCRYPTED) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Encrypted archive entries are not accepted.");
  }
  if (entry.generalPurposeBitFlag & GPBF_DATA_DESCRIPTOR) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Archive entries using a trailing data descriptor are not accepted.");
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", `Unsupported archive compression method: ${entry.compressionMethod}.`);
  }
  if (entry.fileCommentLength !== limits.entryCommentBytes) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Archive entry comments are not accepted.");
  }
  if (entry.fileNameLength > limits.maxFilenameBytes) {
    throw new ArchiveGuardError("ARCHIVE_LIMIT_EXCEEDED", "An archive entry's path exceeds the maximum allowed length.", {
      limit: "maxFilenameBytes",
      maximum: limits.maxFilenameBytes,
      actual: entry.fileNameLength,
    });
  }
  if (entry.extraFieldLength > limits.maxExtraFieldBytes) {
    throw new ArchiveGuardError("ARCHIVE_LIMIT_EXCEEDED", "An archive entry's (central) extra field exceeds the maximum allowed length.", {
      limit: "maxExtraFieldBytes",
      maximum: limits.maxExtraFieldBytes,
      actual: entry.extraFieldLength,
    });
  }
  if (entry.compressedSize > limits.maxCompressedEntryBytes) {
    throw new ArchiveGuardError("ARCHIVE_LIMIT_EXCEEDED", "An archive entry's compressed size exceeds the maximum allowed.", {
      limit: "maxCompressedEntryBytes",
      maximum: limits.maxCompressedEntryBytes,
      actual: entry.compressedSize,
    });
  }
  if (entry.uncompressedSize > limits.maxDeclaredEntryUncompressedBytes) {
    throw new ArchiveGuardError("ARCHIVE_LIMIT_EXCEEDED", "An archive entry's declared uncompressed size exceeds the maximum allowed.", {
      limit: "maxDeclaredEntryUncompressedBytes",
      maximum: limits.maxDeclaredEntryUncompressedBytes,
      actual: entry.uncompressedSize,
    });
  }
  for (const extraField of entry.extraFields) {
    if (extraField.id === ZIP64_EXTRA_FIELD_ID) {
      throw new ArchiveGuardError("UNSAFE_ARCHIVE", "ZIP64 archive entries are not accepted by the initial archive contract.");
    }
  }
}

// ---------------------------------------------------------------------------
// Name policy (Section 15). Runs against RAW filename bytes only —
// `decodeStrings: false` is passed to yauzl (see assertSafeXlsxArchive)
// specifically so this module has exclusive, first-hand control over name
// interpretation and error classification, rather than risking yauzl's own
// internal validateFileName rejecting a subset of unsafe names first (as a
// generic, harder-to-classify error). Worksheet *display* names inside
// workbook XML are unrelated to and unaffected by this ASCII archive-path
// restriction.
// ---------------------------------------------------------------------------

function decodeAndValidateName(
  fileNameRaw: Buffer,
  seenExact: Set<string>,
  seenCaseFold: Set<string>
): string {
  for (let i = 0; i < fileNameRaw.length; i++) {
    const byte = fileNameRaw[i];
    if (byte === 0x00) {
      throw new ArchiveGuardError("UNSAFE_ARCHIVE", "An archive entry name contains a NUL byte.");
    }
    if (byte > 0x7f) {
      throw new ArchiveGuardError("UNSAFE_ARCHIVE", "An archive entry name contains non-ASCII bytes.");
    }
  }
  const name = fileNameRaw.toString("ascii");
  if (name.includes("\\")) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", `An archive entry name contains a backslash: ${name}`);
  }
  if (name.startsWith("/")) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", `An archive entry name is an absolute path: ${name}`);
  }
  if (/^[a-zA-Z]:/.test(name)) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", `An archive entry name is a drive-letter path: ${name}`);
  }
  const isDirectory = name.endsWith("/");
  const pathForSegments = isDirectory ? name.slice(0, -1) : name;
  if (pathForSegments.length === 0) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "An archive entry name is empty.");
  }
  const segments = pathForSegments.split("/");
  for (const segment of segments) {
    if (segment === "") {
      throw new ArchiveGuardError("UNSAFE_ARCHIVE", `An archive entry name contains an empty path component: ${name}`);
    }
    if (segment === ".") {
      throw new ArchiveGuardError("UNSAFE_ARCHIVE", `An archive entry name contains a "." path component: ${name}`);
    }
    if (segment === "..") {
      throw new ArchiveGuardError("UNSAFE_ARCHIVE", `An archive entry name contains a ".." path component: ${name}`);
    }
  }
  if (seenExact.has(name)) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", `Duplicate archive entry name: ${name}`);
  }
  const folded = name.toLowerCase();
  if (seenCaseFold.has(folded)) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", `Archive entry names collide under ASCII case folding: ${name}`);
  }
  seenExact.add(name);
  seenCaseFold.add(folded);
  return name;
}

// ---------------------------------------------------------------------------
// Central/local header equivalence (Section 10) and range/offset safety
// (Section 12). readLocalFileHeader is yauzl's own local-header reader,
// reading from the same original buffer this module was given — this
// module performs no independent binary parsing of the local header itself,
// only comparisons and arithmetic over the fields yauzl already extracted.
// ---------------------------------------------------------------------------

function assertLocalCentralEquivalence(entry: yauzl.Entry, localHeader: yauzl.LocalFileHeader): void {
  if (localHeader.compressionMethod !== entry.compressionMethod) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Archive entry compression method disagreement between central and local headers.");
  }
  if (localHeader.generalPurposeBitFlag !== entry.generalPurposeBitFlag) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Archive entry flag disagreement between central and local headers.");
  }
  if (localHeader.crc32 !== entry.crc32) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Archive entry CRC-32 disagreement between central and local headers.");
  }
  if (localHeader.compressedSize !== entry.compressedSize) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Archive entry compressed-size disagreement between central and local headers.");
  }
  if (localHeader.uncompressedSize !== entry.uncompressedSize) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Archive entry uncompressed-size disagreement between central and local headers.");
  }
  if (!localHeader.fileName.equals(entry.fileNameRaw)) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Archive entry raw filename bytes disagree between central and local headers.");
  }
}

interface EntrySpan {
  start: number;
  end: number;
}

function assertNoRangeConflict(span: EntrySpan, previousSpans: EntrySpan[], centralDirectoryOffset: number): void {
  if (span.end > centralDirectoryOffset) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "An archive entry's data extends into the central directory.");
  }
  for (const previous of previousSpans) {
    if (span.start === previous.start) {
      throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Two archive entries declare the same local-header offset.");
    }
    if (span.start < previous.end && previous.start < span.end) {
      throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Two archive entries' data ranges overlap.");
    }
  }
}

// ---------------------------------------------------------------------------
// Actual streamed validation (Section 9). Every accepted entry is streamed
// in full — never only recognized OOXML part names, since cfb decompresses
// every entry in the archive regardless of name (verified during 5A.2D
// discovery) and a bomb need not use a realistic part name. Chunks are
// counted and CRC-accumulated, then discarded immediately; nothing is ever
// buffered or concatenated.
// ---------------------------------------------------------------------------

function streamAndVerifyEntry(
  zipfile: yauzl.ZipFile,
  entry: yauzl.Entry,
  limits: ArchiveLimits,
  aggregateActual: { value: number }
): Promise<void> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let actualBytes = 0;
      let crc = 0;
      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        stream.destroy();
        reject(error);
      };

      stream.on("data", (chunk: Buffer) => {
        if (settled) return;
        actualBytes += chunk.length;
        aggregateActual.value += chunk.length;
        if (actualBytes > limits.maxActualEntryUncompressedBytes) {
          fail(
            new ArchiveGuardError("ARCHIVE_LIMIT_EXCEEDED", "An archive entry's actual decompressed size exceeds the maximum allowed.", {
              limit: "maxActualEntryUncompressedBytes",
              maximum: limits.maxActualEntryUncompressedBytes,
              actual: actualBytes,
            })
          );
          return;
        }
        if (aggregateActual.value > limits.maxActualAggregateUncompressedBytes) {
          fail(
            new ArchiveGuardError(
              "ARCHIVE_LIMIT_EXCEEDED",
              "The archive's total actual decompressed size exceeds the maximum allowed.",
              {
                limit: "maxActualAggregateUncompressedBytes",
                maximum: limits.maxActualAggregateUncompressedBytes,
                actual: aggregateActual.value,
              }
            )
          );
          return;
        }
        crc = crc32Step(chunk, crc);
      });
      stream.on("error", (streamErr: Error) => fail(streamErr));
      stream.on("end", () => {
        if (settled) return;
        settled = true;
        if (actualBytes !== entry.uncompressedSize) {
          reject(
            new ArchiveGuardError(
              "UNSAFE_ARCHIVE",
              "An archive entry's actual decompressed size did not match its declared uncompressed size."
            )
          );
          return;
        }
        if ((crc >>> 0) !== entry.crc32) {
          reject(new ArchiveGuardError("UNSAFE_ARCHIVE", "An archive entry failed CRC-32 verification."));
          return;
        }
        resolve();
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Lazy entry iteration. fromBufferPromise always sets lazyEntries:true, so
// entries are pulled one at a time — the entry-count cap can therefore stop
// the archive from being read any further the moment it is exceeded,
// without ever asking yauzl to parse a single additional central-directory
// record.
// ---------------------------------------------------------------------------

function readNextEntry(zipfile: yauzl.ZipFile): Promise<yauzl.Entry | null> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: yauzl.Entry) => {
      cleanup();
      resolve(entry);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    function cleanup() {
      zipfile.removeListener("entry", onEntry);
      zipfile.removeListener("end", onEnd);
      zipfile.removeListener("error", onError);
    }
    zipfile.once("entry", onEntry);
    zipfile.once("end", onEnd);
    zipfile.once("error", onError);
    zipfile.readEntry();
  });
}

/**
 * Asserts that `bytes` is a safe XLSX (ZIP) archive to hand to XLSX.read:
 * bounded entry count, bounded declared and *actually streamed* compressed/
 * uncompressed sizes (per-entry and aggregate), verified central/local
 * header equivalence, verified CRC-32, and a narrow accepted archive
 * structure (single-disk, non-ZIP64, STORED/DEFLATE only, no comments, no
 * data descriptors, no encryption, no unsafe/ambiguous/colliding names, no
 * overlapping or trailing archive data). Resolves if and only if the
 * archive is safe to decompress; rejects with an ArchiveGuardError
 * otherwise. Never invokes XLSX.read itself.
 */
export async function assertSafeXlsxArchive(bytes: Uint8Array, limitsOverride?: Partial<ArchiveLimits>): Promise<void> {
  const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...limitsOverride };
  validateArchiveLimits(limits);

  const buffer = toNodeBuffer(bytes);
  const eocd = parseEndOfCentralDirectory(buffer);

  if (eocd.diskNumber !== 0) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Multi-disk archives are not accepted.");
  }
  if (eocd.commentLength !== limits.archiveCommentBytes) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Archive comments are not accepted.");
  }
  if (eocd.entryCount > limits.maxArchiveEntryCount) {
    throw new ArchiveGuardError("ARCHIVE_LIMIT_EXCEEDED", "The archive declares too many entries.", {
      limit: "maxArchiveEntryCount",
      maximum: limits.maxArchiveEntryCount,
      actual: eocd.entryCount,
    });
  }

  let zipfile: yauzl.ZipFile;
  try {
    zipfile = await yauzl.fromBufferPromise(buffer, {
      decodeStrings: false,
      strictFileNames: true,
      validateEntrySizes: true,
    });
  } catch (err) {
    if (err instanceof ArchiveGuardError) throw err;
    throw new ArchiveGuardError("MALFORMED_WORKBOOK", "The archive could not be structurally interpreted.", undefined, err);
  }

  try {
    // Differential cross-check: our own independent EOCD interpretation
    // must agree with yauzl's. Any disagreement means the archive's
    // metadata is ambiguous or was crafted to be interpreted two different
    // ways by two different readers — exactly the class of risk this
    // module exists to close, independent of any specific byte/count limit.
    if (zipfile.fileSize !== buffer.length) {
      throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Archive size disagreement between independent interpretations.");
    }
    if (zipfile.entryCount !== eocd.entryCount) {
      throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Archive entry count disagreement between independent interpretations.");
    }

    const seenExact = new Set<string>();
    const seenCaseFold = new Set<string>();
    const spans: EntrySpan[] = [];
    const aggregateActual = { value: 0 };
    let aggregateDeclared = 0;
    let entriesSeen = 0;

    for (;;) {
      const entry = await readNextEntry(zipfile);
      if (entry === null) break;

      entriesSeen += 1;
      if (entriesSeen > limits.maxArchiveEntryCount) {
        throw new ArchiveGuardError("ARCHIVE_LIMIT_EXCEEDED", "The archive has too many entries.", {
          limit: "maxArchiveEntryCount",
          maximum: limits.maxArchiveEntryCount,
          actual: entriesSeen,
        });
      }

      assertDeclaredEntry(entry, limits);
      decodeAndValidateName(entry.fileNameRaw, seenExact, seenCaseFold);

      aggregateDeclared += entry.uncompressedSize;
      if (aggregateDeclared > limits.maxDeclaredAggregateUncompressedBytes) {
        throw new ArchiveGuardError(
          "ARCHIVE_LIMIT_EXCEEDED",
          "The archive's total declared uncompressed size exceeds the maximum allowed.",
          {
            limit: "maxDeclaredAggregateUncompressedBytes",
            maximum: limits.maxDeclaredAggregateUncompressedBytes,
            actual: aggregateDeclared,
          }
        );
      }

      const localHeader = await zipfile.readLocalFileHeaderPromise(entry);
      if (localHeader.extraFieldLength > limits.maxExtraFieldBytes) {
        throw new ArchiveGuardError(
          "ARCHIVE_LIMIT_EXCEEDED",
          "An archive entry's (local) extra field exceeds the maximum allowed length.",
          {
            limit: "maxExtraFieldBytes",
            maximum: limits.maxExtraFieldBytes,
            actual: localHeader.extraFieldLength,
          }
        );
      }
      assertLocalCentralEquivalence(entry, localHeader);

      const span: EntrySpan = { start: entry.relativeOffsetOfLocalHeader, end: localHeader.fileDataStart + entry.compressedSize };
      assertNoRangeConflict(span, spans, eocd.centralDirectoryOffset);
      spans.push(span);

      await streamAndVerifyEntry(zipfile, entry, limits, aggregateActual);
    }
  } catch (err) {
    if (err instanceof ArchiveGuardError) throw err;
    throw new ArchiveGuardError("MALFORMED_WORKBOOK", "The archive could not be structurally interpreted.", undefined, err);
  } finally {
    zipfile.close();
  }
}
