import { deflateRawSync } from "node:zlib";
import { crc32 as nativeCrc32 } from "node:zlib";

// Small, TEST-ONLY raw ZIP builder. Writes specific (including deliberately
// malformed/inconsistent) binary ZIP structures for 5A.2D's adversarial
// tests. This is permitted, narrowly-scoped test-fixture construction, NOT
// the production ZIP parser (see lib/data-hub/workbookArchiveGuard.ts,
// which contains no ZIP-writing/general-parsing logic of its own). Kept
// tiny and in-memory only — nothing is checked into git as a binary
// fixture.

export interface ZipEntrySpec {
  name: string;
  data: Buffer;
  /** 0 = STORED, 8 = DEFLATE. Default: 0. */
  method?: 0 | 8;
  /** Override the general-purpose bit flag. Default: 0. */
  flags?: number;
  /** Override what the LOCAL header declares (defaults derived from `data`/CRC). */
  localOverride?: Partial<{
    compressedSize: number;
    uncompressedSize: number;
    crc32: number;
    compressionMethod: number;
    generalPurposeBitFlag: number;
    fileName: Buffer;
    extraField: Buffer;
  }>;
  /** Override what the CENTRAL directory declares for this entry (defaults mirror the local header). */
  centralOverride?: Partial<{
    compressedSize: number;
    uncompressedSize: number;
    crc32: number;
    compressionMethod: number;
    generalPurposeBitFlag: number;
    fileName: Buffer;
    extraField: Buffer;
    fileCommentLength: number;
    relativeOffsetOfLocalHeader: number;
  }>;
  /** Raw bytes appended after the compressed data and before the next entry (e.g. to fake a data descriptor). Default: none. */
  trailingBytes?: Buffer;
  /** Omit this entry's central-directory record entirely (used to build offset/overlap edge cases). */
  omitFromCentralDirectory?: boolean;
}

export interface BuildZipOptions {
  /** Whole-archive comment. Default: empty. */
  comment?: Buffer;
  /** Extra raw bytes appended after the real end-of-central-directory record. */
  trailingGarbage?: Buffer;
  /** Override the EOCD's declared disk number. Default: 0. */
  diskNumberOverride?: number;
  /** Override the EOCD's declared entry count. Default: real count. */
  entryCountOverride?: number;
  /** Override the EOCD's declared central-directory offset. Default: real offset. */
  centralDirectoryOffsetOverride?: number;
  /** Override the EOCD's declared "disk where the central directory starts" field (offset +6). Default: 0. */
  centralDirectoryStartDiskOverride?: number;
  /** Override the EOCD's declared "entries on this disk" field (offset +8). Default: real entry count. */
  entriesOnThisDiskOverride?: number;
  /** Override the EOCD's declared central-directory size field (offset +12). Default: real size. */
  centralDirectorySizeOverride?: number;
  /** Prepend a fabricated ZIP64 end-of-central-directory locator immediately before the EOCD. */
  fakeZip64Locator?: boolean;
}

function crc32(data: Buffer): number {
  return nativeCrc32(data) >>> 0;
}

/** Builds a real, byte-accurate ZIP archive (optionally with deliberately inconsistent/malformed structure) entirely in memory. */
export function buildZip(entries: ZipEntrySpec[], options: BuildZipOptions = {}): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offsetCursor = 0;
  const localOffsets: number[] = [];

  for (const spec of entries) {
    const method = spec.method ?? 0;
    const realCompressed = method === 8 ? deflateRawSync(spec.data) : spec.data;
    const realCrc = crc32(spec.data);

    const nameBuf = Buffer.from(spec.name, "ascii");
    const localFlags = spec.localOverride?.generalPurposeBitFlag ?? spec.flags ?? 0;
    const localMethod = spec.localOverride?.compressionMethod ?? method;
    const localCrc = spec.localOverride?.crc32 ?? realCrc;
    const localCompressedSize = spec.localOverride?.compressedSize ?? realCompressed.length;
    const localUncompressedSize = spec.localOverride?.uncompressedSize ?? spec.data.length;
    const localName = spec.localOverride?.fileName ?? nameBuf;
    const localExtra = spec.localOverride?.extraField ?? Buffer.alloc(0);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(localFlags, 6);
    localHeader.writeUInt16LE(localMethod, 8);
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x21, 12); // mod date
    localHeader.writeUInt32LE(localCrc, 14);
    localHeader.writeUInt32LE(localCompressedSize, 18);
    localHeader.writeUInt32LE(localUncompressedSize, 22);
    localHeader.writeUInt16LE(localName.length, 26);
    localHeader.writeUInt16LE(localExtra.length, 28);

    const localHeaderOffset = offsetCursor;
    localOffsets.push(localHeaderOffset);

    const localEntry = Buffer.concat([
      localHeader,
      localName,
      localExtra,
      realCompressed,
      spec.trailingBytes ?? Buffer.alloc(0),
    ]);
    localChunks.push(localEntry);
    offsetCursor += localEntry.length;

    if (spec.omitFromCentralDirectory) continue;

    const centralFlags = spec.centralOverride?.generalPurposeBitFlag ?? spec.flags ?? 0;
    const centralMethod = spec.centralOverride?.compressionMethod ?? method;
    const centralCrc = spec.centralOverride?.crc32 ?? realCrc;
    const centralCompressedSize = spec.centralOverride?.compressedSize ?? realCompressed.length;
    const centralUncompressedSize = spec.centralOverride?.uncompressedSize ?? spec.data.length;
    const centralName = spec.centralOverride?.fileName ?? nameBuf;
    const centralExtra = spec.centralOverride?.extraField ?? Buffer.alloc(0);
    const centralCommentLength = spec.centralOverride?.fileCommentLength ?? 0;
    const centralRelativeOffset = spec.centralOverride?.relativeOffsetOfLocalHeader ?? localHeaderOffset;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(centralFlags, 8);
    centralHeader.writeUInt16LE(centralMethod, 10);
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0x21, 14); // mod date
    centralHeader.writeUInt32LE(centralCrc, 16);
    centralHeader.writeUInt32LE(centralCompressedSize, 20);
    centralHeader.writeUInt32LE(centralUncompressedSize, 24);
    centralHeader.writeUInt16LE(centralName.length, 28);
    centralHeader.writeUInt16LE(centralExtra.length, 30);
    centralHeader.writeUInt16LE(centralCommentLength, 32);
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(centralRelativeOffset, 42);

    const fileComment = Buffer.alloc(centralCommentLength);
    centralChunks.push(Buffer.concat([centralHeader, centralName, centralExtra, fileComment]));
  }

  const localData = Buffer.concat(localChunks);
  const centralDirectoryOffset = options.centralDirectoryOffsetOverride ?? localData.length;
  const centralData = Buffer.concat(centralChunks);
  const entryCount = options.entryCountOverride ?? centralChunks.length;
  const comment = options.comment ?? Buffer.alloc(0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.diskNumberOverride ?? 0, 4);
  eocd.writeUInt16LE(options.centralDirectoryStartDiskOverride ?? 0, 6);
  eocd.writeUInt16LE(options.entriesOnThisDiskOverride ?? entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(options.centralDirectorySizeOverride ?? centralData.length, 12);
  eocd.writeUInt32LE(centralDirectoryOffset, 16);
  eocd.writeUInt16LE(comment.length, 20);

  const zip64Locator = options.fakeZip64Locator
    ? (() => {
        const buf = Buffer.alloc(20);
        buf.writeUInt32LE(0x07064b50, 0);
        buf.writeUInt32LE(0, 4);
        buf.writeBigUInt64LE(BigInt(0), 8);
        buf.writeUInt32LE(1, 16);
        return buf;
      })()
    : Buffer.alloc(0);

  return Buffer.concat([localData, centralData, zip64Locator, eocd, comment, options.trailingGarbage ?? Buffer.alloc(0)]);
}

/** A single-entry archive with a real, valid DEFLATE payload of `repeatedByte` repeated `size` times — highly compressible, used for expansion-ratio tests. */
export function buildHighlyCompressibleEntry(name: string, size: number, repeatedByte = 0x41): Buffer {
  return Buffer.alloc(size, repeatedByte);
}
