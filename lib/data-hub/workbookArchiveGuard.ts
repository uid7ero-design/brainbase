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

// ---------------------------------------------------------------------------
// General-purpose bit flag policy (R1 remediation).
//
// R0 checked only two named bits (encrypted, data descriptor) and let
// everything else — including 0x2000 ("masking of values", used with
// strong/central-directory encryption) — through unexamined, as long as the
// central and local copies agreed with each other. Codex independently
// proved a 0x2000 archive (central and local agreeing) passed this guard
// while CFB's own hardcoded rejection mask, `flags & 0x2041` (bits 0/6/13 =
// encrypted, strong-encryption, masked-values), throws on it — a real
// divergent-interpretation gap between this guard and the thing it protects.
//
// Fixed with an explicit ALLOW-list rather than an ever-growing deny-list:
// KNOWN_ALLOWED_GENERAL_PURPOSE_FLAGS is 0x0000 — no bit is allowed. This is
// not an arbitrary strict default; it is the empirically-observed value for
// EVERY entry in the two only real xlsx byte-streams available in this
// repository: (a) SheetJS's own `XLSX.write` output (used throughout this
// test suite) and (b) the one real, non-generated fixture checked into the
// repo, public/fleet-dummy-data.xlsx (verified directly against both via
// yauzl during this remediation). Neither ever sets the DEFLATE
// compression-sub-type bits (1-2) or the UTF-8-name bit (11); both are
// genuinely optional per the ZIP spec (DEFLATE decodes identically
// regardless of the advisory sub-type bits, and our contract already
// requires ASCII-only names, which are valid UTF-8 by construction whether
// or not the bit is set). Widening this mask to admit a specific additional
// bit is a legitimate future contract change, but it must be made the same
// way this one was: with a real byte-level fixture proving the bit is both
// necessary and safe, never by assumption. `flags & ~KNOWN_ALLOWED_...`
// nonzero is rejected regardless of which bit it is — a bit this module
// doesn't yet have a name for is exactly as disallowed as one it does.
const KNOWN_ALLOWED_GENERAL_PURPOSE_FLAGS = 0x0000;

// Named subset of the disallowed space, checked first only so the rejection
// reason is specific and stable for diagnostics/tests — every one of these
// is already covered by (and would still be rejected by) the generic
// allow-mask check below even if this module never named it.
const GPBF_ENCRYPTED = 0x0001;
const GPBF_DATA_DESCRIPTOR = 0x0008;
const GPBF_STRONG_ENCRYPTION = 0x0040;
const GPBF_MASKED_VALUES = 0x2000; // "masking of values" — used with strong/central-directory encryption; the exact bit Codex proved bypassed R0.

function assertAllowedGeneralPurposeFlags(flags: number, headerLabel: "central" | "local"): void {
  if (flags & GPBF_ENCRYPTED) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", `Encrypted archive entries are not accepted (${headerLabel} header).`);
  }
  if (flags & GPBF_DATA_DESCRIPTOR) {
    throw new ArchiveGuardError(
      "UNSAFE_ARCHIVE",
      `Archive entries using a trailing data descriptor are not accepted (${headerLabel} header).`
    );
  }
  if (flags & GPBF_STRONG_ENCRYPTION) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", `Archive entries using strong encryption are not accepted (${headerLabel} header).`);
  }
  if (flags & GPBF_MASKED_VALUES) {
    throw new ArchiveGuardError(
      "UNSAFE_ARCHIVE",
      `Archive entries using masked central-directory values are not accepted (${headerLabel} header).`
    );
  }
  if ((flags & ~KNOWN_ALLOWED_GENERAL_PURPOSE_FLAGS) !== 0) {
    throw new ArchiveGuardError(
      "UNSAFE_ARCHIVE",
      `Archive entry uses a disallowed general-purpose flag combination: 0x${flags.toString(16)} (${headerLabel} header).`
    );
  }
}

interface EndOfCentralDirectory {
  /** Offset +4: number of THIS disk. */
  diskNumber: number;
  /** Offset +6: number of the disk where the central directory STARTS. R0 never parsed this field at all. */
  centralDirectoryStartDisk: number;
  /** Offset +8: total entries in the central directory ON THIS DISK. R0 never parsed this field at all. */
  entriesOnThisDisk: number;
  /** Offset +10: total entries in the central directory, across all disks. */
  entryCount: number;
  /** Offset +12: size, in bytes, of the central directory. R0 never parsed this field at all. */
  centralDirectorySize: number;
  /** Offset +16: offset of the start of the central directory. */
  centralDirectoryOffset: number;
  commentLength: number;
  /** The absolute byte position at which this record's own signature was found — needed to validate the central-directory extent below. */
  eocdOffset: number;
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
    centralDirectoryStartDisk: buffer.readUInt16LE(eocdOffset + 6),
    entriesOnThisDisk: buffer.readUInt16LE(eocdOffset + 8),
    entryCount: buffer.readUInt16LE(eocdOffset + 10),
    centralDirectorySize: buffer.readUInt32LE(eocdOffset + 12),
    centralDirectoryOffset: buffer.readUInt32LE(eocdOffset + 16),
    commentLength,
    eocdOffset,
  };
}

// ---------------------------------------------------------------------------
// Per-entry declared-metadata checks (Section 8 of the approved contract):
// everything checkable from the central-directory Entry alone, before any
// I/O or decompression. Cheapest checks first.
// ---------------------------------------------------------------------------

function assertDeclaredEntry(entry: yauzl.Entry, limits: ArchiveLimits): void {
  assertAllowedGeneralPurposeFlags(entry.generalPurposeBitFlag, "central");
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
  // CENTRAL copy only — entry.extraFields is yauzl's own parse of the
  // central directory's extra-field bytes. This does NOT see the LOCAL
  // header's own, independent extra-field bytes; see
  // assertLocalExtraFieldSafe below for why that copy needs its own,
  // equally-strict check.
  for (const extraField of entry.extraFields) {
    if (extraField.id === ZIP64_EXTRA_FIELD_ID) {
      throw new ArchiveGuardError("UNSAFE_ARCHIVE", "ZIP64 archive entries are not accepted by the initial archive contract (central header).");
    }
  }
}

// ---------------------------------------------------------------------------
// Local extra-field safety (R1 remediation, Codex blocker #2).
//
// R0 only ever inspected the CENTRAL directory's extra fields for a ZIP64
// id (0x0001). Codex independently constructed an archive whose CENTRAL
// extra field was clean but whose LOCAL header carried its own ZIP64 extra
// field — accepted by R0, since nothing ever parsed the local header's own
// extra-field bytes at all (yauzl's `readLocalFileHeaderPromise` returns
// them as a raw, unparsed `extraField: Buffer` — see @types/yauzl). Central
// and local extra fields are two independent byte regions in a real ZIP;
// equal *sizes* (checked elsewhere) says nothing about equal *contents*.
//
// This calls yauzl's own exported `parseExtraFields` — the exact function
// yauzl uses internally to build `entry.extraFields` for the central copy —
// rather than hand-rolling a second extra-field parser. This is
// deliberately not "our own general extra-field parser": it is reuse of
// yauzl's one implementation, applied to a byte region yauzl itself never
// runs it against. yauzl's parseExtraFields throws a plain Error if a
// declared per-field data size would run past the supplied buffer
// (truncated framing) — that throw propagates up to assertSafeXlsxArchive's
// outer catch and is correctly reclassified as MALFORMED_WORKBOOK there,
// the same bucket a truncated EOCD/central-directory record falls into.
//
// yauzl's loop additionally tolerates a *trailing* 1-3 stray bytes that
// don't form a complete 4-byte field header at all (its `while (i <
// buffer.length - 3)` condition simply stops, rather than erroring) — a
// real-world padding convention some writers use. This module's own
// contract is stricter: the declared extraFieldLength must be fully and
// exactly consumed by whole fields, with zero leftover bytes, or the
// framing is treated as malformed (MALFORMED_WORKBOOK) rather than
// silently tolerated. There is no legitimate reason for a genuine OOXML
// writer's extra field region to end mid-header, and admitting that
// ambiguity here would reopen exactly the kind of "two readers, two
// interpretations" gap this whole module exists to close.
// ---------------------------------------------------------------------------

function parseAndValidateExtraFields(extraFieldBuffer: Buffer, headerLabel: "central" | "local"): yauzl.ExtraField[] {
  let fields: yauzl.ExtraField[];
  try {
    fields = yauzl.parseExtraFields(extraFieldBuffer);
  } catch (err) {
    throw new ArchiveGuardError(
      "MALFORMED_WORKBOOK",
      `An archive entry's ${headerLabel} extra field is malformed or truncated.`,
      undefined,
      err
    );
  }
  const consumedBytes = fields.reduce((sum, field) => sum + 4 + field.data.length, 0);
  if (consumedBytes !== extraFieldBuffer.length) {
    throw new ArchiveGuardError(
      "MALFORMED_WORKBOOK",
      `An archive entry's ${headerLabel} extra field has trailing bytes that do not form a complete field.`
    );
  }
  return fields;
}

function assertLocalExtraFieldSafe(localHeader: yauzl.LocalFileHeader): void {
  const fields = parseAndValidateExtraFields(localHeader.extraField, "local");
  for (const extraField of fields) {
    if (extraField.id === ZIP64_EXTRA_FIELD_ID) {
      // Rejected unconditionally — including an empty-payload ZIP64 field
      // (data.length === 0) — per the initial contract: the mere presence
      // of a ZIP64 extra field id is the policy violation, independent of
      // whether the central directory's own sizes already fit in 32 bits.
      throw new ArchiveGuardError("UNSAFE_ARCHIVE", "ZIP64 archive entries are not accepted by the initial archive contract (local header).");
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

// ---------------------------------------------------------------------------
// Reclassification of specific, known yauzl-internal rejections (R1
// remediation).
//
// yauzl performs a small number of its own hardcoded structural checks
// DURING central-directory entry parsing — before this module's own
// assertDeclaredEntry ever runs on the resulting Entry — and reports a
// rejection as a plain, uncoded `Error` on the zipfile's 'error' event.
// Left unhandled, that plain Error would fall into the generic
// MALFORMED_WORKBOOK catch-all below, even though the actual reason is a
// specific, well-understood safety violation this module has its own
// stable UNSAFE_ARCHIVE classification for. Reproduced directly during R1
// remediation: a 0x0040 (strong-encryption) entry never reaches
// assertDeclaredEntry at all — yauzl's own `if (entry.generalPurposeBitFlag
// & 0x40) return emitErrorAndAutoClose(...)` fires first. This function
// inspects (never re-throws or exposes) yauzl's raw message only to choose
// the correct PUBLIC classification; the raw string itself is never part of
// the public error contract (see WorkbookParserError in workbookParser.ts,
// which never surfaces `cause`).
// ---------------------------------------------------------------------------

function reclassifyKnownYauzlError(err: unknown): ArchiveGuardError | null {
  if (!(err instanceof Error)) return null;
  if (err.message === "strong encryption is not supported") {
    return new ArchiveGuardError("UNSAFE_ARCHIVE", "Archive entries using strong encryption are not accepted.", undefined, err);
  }
  return null;
}

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
  // R0 checked only "number of THIS disk" and left the other two
  // single-disk EOCD fields ("disk where the central directory starts" and
  // "entries on this disk") entirely unparsed and unchecked — Codex
  // independently reproduced acceptance of an archive with an invalid value
  // in one of these. A genuinely single-disk archive has all three fields
  // mutually consistent by construction (0, 0, entryCount); requiring that
  // explicitly, rather than only the first field, closes the gap.
  if (eocd.centralDirectoryStartDisk !== 0) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "Multi-disk archives are not accepted (central directory does not start on disk 0).");
  }
  if (eocd.entriesOnThisDisk !== eocd.entryCount) {
    throw new ArchiveGuardError(
      "UNSAFE_ARCHIVE",
      "Multi-disk archives are not accepted (entries on this disk does not match the total entry count)."
    );
  }
  // Central-directory extent invariant (R1 remediation): the central
  // directory must occupy the EXACT declared byte interval immediately
  // preceding the EOCD record this module independently selected — no gap,
  // no overlap, no ambiguity about where it starts or ends. This is not an
  // invented tolerance-free rule for its own sake: it is empirically
  // verified (during this remediation, against both a fresh SheetJS-written
  // xlsx and the real public/fleet-dummy-data.xlsx fixture already in this
  // repo) to hold exactly for genuinely valid archives, and it is also the
  // exact mechanism that rejects a naive "ZIP A || ZIP B" concatenation
  // without any bespoke concatenation-detection logic: the trailing
  // archive's own EOCD declares a centralDirectoryOffset relative to ITS
  // OWN original standalone byte layout, which no longer equals
  // (eocdOffset - centralDirectorySize) once a leading archive's bytes have
  // been prepended. See the "concatenated archive" test for the empirical
  // evidence this claim is based on, including a direct comparison against
  // yauzl's own (unguarded) behavior on the same bytes.
  if (eocd.centralDirectoryOffset > buffer.length || eocd.centralDirectorySize > buffer.length) {
    throw new ArchiveGuardError("UNSAFE_ARCHIVE", "The archive's declared central-directory offset or size exceeds the archive's actual length.");
  }
  if (eocd.centralDirectoryOffset + eocd.centralDirectorySize !== eocd.eocdOffset) {
    throw new ArchiveGuardError(
      "UNSAFE_ARCHIVE",
      "The archive's central directory does not occupy the exact interval preceding its end-of-central-directory record."
    );
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
    const reclassified = reclassifyKnownYauzlError(err);
    if (reclassified) throw reclassified;
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
      // Independent of the central-copy flag check in assertDeclaredEntry
      // (and independent of the *equality* check inside
      // assertLocalCentralEquivalence just below) — both call sites share
      // the same KNOWN_ALLOWED_GENERAL_PURPOSE_FLAGS mask, so a disallowed
      // value is caught here even in the case assertLocalCentralEquivalence
      // alone could not: central and local agreeing on a disallowed value.
      assertAllowedGeneralPurposeFlags(localHeader.generalPurposeBitFlag, "local");
      // Independent of the central-copy ZIP64 check in assertDeclaredEntry
      // — see assertLocalExtraFieldSafe's own header comment for why the
      // central and local extra-field byte regions must each be checked.
      assertLocalExtraFieldSafe(localHeader);
      assertLocalCentralEquivalence(entry, localHeader);

      const span: EntrySpan = { start: entry.relativeOffsetOfLocalHeader, end: localHeader.fileDataStart + entry.compressedSize };
      assertNoRangeConflict(span, spans, eocd.centralDirectoryOffset);
      spans.push(span);

      await streamAndVerifyEntry(zipfile, entry, limits, aggregateActual);
    }
  } catch (err) {
    if (err instanceof ArchiveGuardError) throw err;
    const reclassified = reclassifyKnownYauzlError(err);
    if (reclassified) throw reclassified;
    throw new ArchiveGuardError("MALFORMED_WORKBOOK", "The archive could not be structurally interpreted.", undefined, err);
  } finally {
    zipfile.close();
  }
}
