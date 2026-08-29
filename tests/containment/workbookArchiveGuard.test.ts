import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { deflateRawSync } from 'node:zlib'
import * as XLSX from 'xlsx'
import {
  assertSafeXlsxArchive,
  ArchiveGuardError,
  DEFAULT_ARCHIVE_LIMITS,
} from '@/lib/data-hub/workbookArchiveGuard'
import { xlsxAdapter, inspectWorkbook, decodeWorksheet, WorkbookParserError } from '@/lib/data-hub/workbookParser'
import { buildZip } from '../helpers/testZipBuilder'

// Data Hub 5A.2D — behavioral proof for the XLSX archive/decompression
// boundary. Real in-memory ZIP archives only (hand-built via
// tests/helpers/testZipBuilder.ts, following the exact convention already
// established in workbookParser.test.ts's buildMinimalValidZip) — nothing
// is checked into git as a binary fixture, and nothing here mocks the ZIP
// format itself. Where a scenario needs to isolate exactly one limit
// category, it injects a small custom limit override rather than
// allocating a multi-megabyte fixture to hit a production-sized default —
// the DEFAULT_ARCHIVE_LIMITS values themselves are checked separately
// below and exercised end-to-end by the two full-scale expansion tests.

function realZip(name: string, data: Buffer, method: 0 | 8 = 0) {
  return buildZip([{ name, data, method }])
}

describe('memory: no decompressed-content accumulation (static proof)', () => {
  // A behavioral proof of absence is impractical here — there is no
  // observable difference in test output between "streamed and discarded"
  // and "streamed and secretly retained" without instrumenting Node's heap.
  // Source-text containment is the direct, correct tool: this module must
  // never build up a decompressed entry's full content in memory.
  const SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../../lib/data-hub/workbookArchiveGuard.ts'),
    'utf-8'
  )

  it('never concatenates or accumulates decompressed chunk buffers', () => {
    expect(SOURCE).not.toMatch(/Buffer\.concat/)
    expect(SOURCE).not.toMatch(/chunks\s*\.\s*push/)
    expect(SOURCE).not.toMatch(/\.push\(chunk\)/)
  })
})

describe('DEFAULT_ARCHIVE_LIMITS', () => {
  it('exposes the approved 5A.2D default constants', () => {
    expect(DEFAULT_ARCHIVE_LIMITS).toEqual({
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
    })
  })
})

describe('validity / regression', () => {
  it('accepts a representative real xlsx produced by SheetJS itself', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2]]), 'Sheet1')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer
    await expect(assertSafeXlsxArchive(new Uint8Array(buf))).resolves.toBeUndefined()
  })

  it('accepts a minimal single-entry STORED archive', async () => {
    await expect(assertSafeXlsxArchive(new Uint8Array(realZip('a.txt', Buffer.from('hello'))))).resolves.toBeUndefined()
  })

  it('accepts a minimal single-entry DEFLATE archive', async () => {
    await expect(
      assertSafeXlsxArchive(new Uint8Array(realZip('a.txt', Buffer.from('hello world, hello world'), 8)))
    ).resolves.toBeUndefined()
  })

  it('accepts multiple entries including a directory marker', async () => {
    const zip = buildZip([
      { name: 'xl/', data: Buffer.alloc(0) },
      { name: 'xl/workbook.xml', data: Buffer.from('<workbook/>'), method: 8 },
      { name: '[Content_Types].xml', data: Buffer.from('<ct/>') },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).resolves.toBeUndefined()
  })
})

describe('entry count', () => {
  function buildWithCount(n: number) {
    const entries = []
    for (let i = 0; i < n; i++) entries.push({ name: `f${i}.txt`, data: Buffer.from('x') })
    return buildZip(entries)
  }

  it('exactly at the limit passes', async () => {
    const zip = buildWithCount(5)
    await expect(assertSafeXlsxArchive(new Uint8Array(zip), { maxArchiveEntryCount: 5 })).resolves.toBeUndefined()
  })

  it('limit + 1 fails', async () => {
    const zip = buildWithCount(6)
    await expect(assertSafeXlsxArchive(new Uint8Array(zip), { maxArchiveEntryCount: 5 })).rejects.toMatchObject({
      code: 'ARCHIVE_LIMIT_EXCEEDED',
      details: { limit: 'maxArchiveEntryCount' },
    })
  })
})

describe('compressed entry bytes', () => {
  it('exactly at the limit passes', async () => {
    const zip = realZip('a.txt', Buffer.from('hello'))
    // 'hello' STORED compresses to exactly 5 bytes.
    await expect(assertSafeXlsxArchive(new Uint8Array(zip), { maxCompressedEntryBytes: 5 })).resolves.toBeUndefined()
  })

  it('limit + 1 fails (declared-metadata check, no real oversized fixture needed)', async () => {
    const zip = buildZip([
      {
        name: 'a.bin',
        data: Buffer.from('tiny'),
        method: 8,
        localOverride: { compressedSize: 1000 },
        centralOverride: { compressedSize: 1000 },
      },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip), { maxCompressedEntryBytes: 999 })).rejects.toMatchObject({
      code: 'ARCHIVE_LIMIT_EXCEEDED',
      details: { limit: 'maxCompressedEntryBytes' },
    })
  })
})

describe('declared entry uncompressed bytes', () => {
  it('exactly at the limit passes (declared matches real content honestly)', async () => {
    const data = Buffer.alloc(100, 0x41)
    const zip = realZip('a.bin', data)
    await expect(
      assertSafeXlsxArchive(new Uint8Array(zip), { maxDeclaredEntryUncompressedBytes: 100 })
    ).resolves.toBeUndefined()
  })

  it('limit + 1 fails (declared lies upward; real content stays tiny, no streaming needed to reject)', async () => {
    const zip = buildZip([
      {
        name: 'a.bin',
        data: Buffer.from('tiny'),
        method: 8,
        localOverride: { uncompressedSize: 200 * 1024 * 1024 },
        centralOverride: { uncompressedSize: 200 * 1024 * 1024 },
      },
    ])
    await expect(
      assertSafeXlsxArchive(new Uint8Array(zip), { maxDeclaredEntryUncompressedBytes: 200 * 1024 * 1024 - 1 })
    ).rejects.toMatchObject({ code: 'ARCHIVE_LIMIT_EXCEEDED', details: { limit: 'maxDeclaredEntryUncompressedBytes' } })
  })
})

describe('actual entry uncompressed bytes (real streamed content, declared honestly)', () => {
  it('exactly at the limit passes', async () => {
    const data = Buffer.alloc(10_000, 0x42)
    const zip = realZip('a.bin', data, 8)
    await expect(
      assertSafeXlsxArchive(new Uint8Array(zip), {
        maxDeclaredEntryUncompressedBytes: 10_000,
        maxActualEntryUncompressedBytes: 10_000,
      })
    ).resolves.toBeUndefined()
  })

  it('limit + 1 fails, caught mid-stream even though declared size is honest', async () => {
    const data = Buffer.alloc(10_000, 0x42)
    const zip = realZip('a.bin', data, 8)
    await expect(
      assertSafeXlsxArchive(new Uint8Array(zip), {
        maxDeclaredEntryUncompressedBytes: 10_000,
        maxActualEntryUncompressedBytes: 9_999,
      })
    ).rejects.toMatchObject({ code: 'ARCHIVE_LIMIT_EXCEEDED', details: { limit: 'maxActualEntryUncompressedBytes' } })
  })
})

describe('declared aggregate uncompressed bytes', () => {
  it('exactly at the limit passes', async () => {
    const zip = buildZip([
      { name: 'a.bin', data: Buffer.alloc(60) },
      { name: 'b.bin', data: Buffer.alloc(40) },
    ])
    await expect(
      assertSafeXlsxArchive(new Uint8Array(zip), {
        maxDeclaredEntryUncompressedBytes: 60,
        maxDeclaredAggregateUncompressedBytes: 100,
      })
    ).resolves.toBeUndefined()
  })

  it('limit + 1 fails', async () => {
    const zip = buildZip([
      { name: 'a.bin', data: Buffer.alloc(60) },
      { name: 'b.bin', data: Buffer.alloc(41) },
    ])
    await expect(
      assertSafeXlsxArchive(new Uint8Array(zip), {
        maxDeclaredEntryUncompressedBytes: 60,
        maxDeclaredAggregateUncompressedBytes: 100,
      })
    ).rejects.toMatchObject({ code: 'ARCHIVE_LIMIT_EXCEEDED', details: { limit: 'maxDeclaredAggregateUncompressedBytes' } })
  })
})

describe('actual aggregate uncompressed bytes (real streamed content)', () => {
  it('exactly at the limit passes', async () => {
    const zip = buildZip([
      { name: 'a.bin', data: Buffer.alloc(6_000, 0x41), method: 8 },
      { name: 'b.bin', data: Buffer.alloc(4_000, 0x42), method: 8 },
    ])
    await expect(
      assertSafeXlsxArchive(new Uint8Array(zip), {
        maxDeclaredEntryUncompressedBytes: 6_000,
        maxActualEntryUncompressedBytes: 6_000,
        maxDeclaredAggregateUncompressedBytes: 10_000,
        maxActualAggregateUncompressedBytes: 10_000,
      })
    ).resolves.toBeUndefined()
  })

  it('limit + 1 fails', async () => {
    const zip = buildZip([
      { name: 'a.bin', data: Buffer.alloc(6_000, 0x41), method: 8 },
      { name: 'b.bin', data: Buffer.alloc(4_001, 0x42), method: 8 },
    ])
    await expect(
      assertSafeXlsxArchive(new Uint8Array(zip), {
        maxDeclaredEntryUncompressedBytes: 6_001,
        maxActualEntryUncompressedBytes: 6_001,
        maxDeclaredAggregateUncompressedBytes: 10_001,
        maxActualAggregateUncompressedBytes: 10_000,
      })
    ).rejects.toMatchObject({ code: 'ARCHIVE_LIMIT_EXCEEDED', details: { limit: 'maxActualAggregateUncompressedBytes' } })
  })
})

describe('name / extra-field length', () => {
  it('filename exactly at the limit passes', async () => {
    const name = 'a'.repeat(20)
    const zip = realZip(name, Buffer.from('x'))
    await expect(assertSafeXlsxArchive(new Uint8Array(zip), { maxFilenameBytes: 20 })).resolves.toBeUndefined()
  })

  it('filename limit + 1 fails', async () => {
    const name = 'a'.repeat(21)
    const zip = realZip(name, Buffer.from('x'))
    await expect(assertSafeXlsxArchive(new Uint8Array(zip), { maxFilenameBytes: 20 })).rejects.toMatchObject({
      code: 'ARCHIVE_LIMIT_EXCEEDED',
      details: { limit: 'maxFilenameBytes' },
    })
  })

  it('extra field exactly at the limit passes', async () => {
    // A minimal, well-formed (but unrecognized id) extra field record: 2-byte id + 2-byte length + 0 bytes data = 4 bytes.
    const extra = Buffer.from([0xff, 0xff, 0x00, 0x00])
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), localOverride: { extraField: extra }, centralOverride: { extraField: extra } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip), { maxExtraFieldBytes: 4 })).resolves.toBeUndefined()
  })

  it('extra field limit + 1 fails', async () => {
    // A minimal, well-formed (but unrecognized id) extra field record: 2-byte id + 2-byte length + 0 bytes data = 4 bytes.
    const extra = Buffer.from([0xff, 0xff, 0x00, 0x00])
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), localOverride: { extraField: extra }, centralOverride: { extraField: extra } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip), { maxExtraFieldBytes: 3 })).rejects.toMatchObject({
      code: 'ARCHIVE_LIMIT_EXCEEDED',
      details: { limit: 'maxExtraFieldBytes' },
    })
  })
})

describe('comments rejected', () => {
  it('a nonzero archive comment is rejected', async () => {
    const zip = realZip('a.txt', Buffer.from('x'))
    const withComment = buildZip([{ name: 'a.txt', data: Buffer.from('x') }], { comment: Buffer.from('hi') })
    expect(withComment.length).toBeGreaterThan(zip.length)
    await expect(assertSafeXlsxArchive(new Uint8Array(withComment))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a nonzero entry comment is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), centralOverride: { fileCommentLength: 3 } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })
})

describe('expansion', () => {
  it('real high-compression content well within default limits is accepted', async () => {
    const data = Buffer.alloc(1_000_000, 0x41) // 1 MiB, compresses to almost nothing
    const zip = realZip('a.bin', data, 8)
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).resolves.toBeUndefined()
  })

  it('a real extreme-expansion entry is rejected under the default limits', async () => {
    const bomb = Buffer.alloc(100 * 1024 * 1024, 0x41) // 100 MiB, well beyond the 64 MiB default actual-entry cap
    const zip = realZip('a.bin', bomb, 8)
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'ARCHIVE_LIMIT_EXCEEDED' })
  }, 20_000)

  it('tiny compressed content with a huge declared local uncompressed size is rejected before any streaming — proven by the rejection reason, not just "it throws"', async () => {
    const zip = buildZip([
      {
        name: 'a.bin',
        data: Buffer.from('tiny'),
        method: 8,
        localOverride: { uncompressedSize: 2 * 1024 * 1024 * 1024 - 1 },
        centralOverride: { uncompressedSize: 2 * 1024 * 1024 * 1024 - 1 },
      },
    ])
    const err = await assertSafeXlsxArchive(new Uint8Array(zip)).catch((e) => e)
    expect(err).toBeInstanceOf(ArchiveGuardError)
    expect(err.code).toBe('ARCHIVE_LIMIT_EXCEEDED')
    expect(err.details?.limit).toBe('maxDeclaredEntryUncompressedBytes')
  })
})

describe('central / local header equivalence', () => {
  it('uncompressed-size disagreement is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello'), localOverride: { uncompressedSize: 999 } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('compressed-size disagreement is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello'), method: 8, localOverride: { compressedSize: 999 } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('CRC-32 disagreement is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello'), localOverride: { crc32: 1 }, centralOverride: { crc32: 1 } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('compression-method disagreement is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello'), localOverride: { compressionMethod: 8 } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('general-purpose flag disagreement is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello'), localOverride: { generalPurposeBitFlag: 0x0002 } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a raw filename byte disagreement that differs only by ASCII case is still rejected — proves the comparison is byte-exact, not a lossy/case-insensitive decoded-string comparison', async () => {
    // Both 'a.txt' and 'A.txt' independently satisfy the ASCII-only name
    // policy — this specifically isolates whether the central/local
    // equivalence check itself does a true raw-byte comparison (it must
    // reject this) rather than something that happens to treat
    // case-different names as equivalent.
    const zip = buildZip([
      {
        name: 'a.txt',
        data: Buffer.from('hello'),
        localOverride: { fileName: Buffer.from('A.txt') },
        centralOverride: { fileName: Buffer.from('a.txt') },
      },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('raw filename byte disagreement is rejected (not just decoded-string comparison)', async () => {
    const zip = buildZip([
      {
        name: 'a.txt',
        data: Buffer.from('hello'),
        localOverride: { fileName: Buffer.from('a.txt') },
        centralOverride: { fileName: Buffer.from('A.txt') },
      },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })
})

describe('structure', () => {
  it('an encrypted entry is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), method: 8, flags: 0x1 }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('an unsupported compression method is rejected', async () => {
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('x'), localOverride: { compressionMethod: 12 }, centralOverride: { compressionMethod: 12 } },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a fabricated ZIP64 end-of-central-directory locator is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x') }], { fakeZip64Locator: true })
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a ZIP64 extra field on an entry is rejected', async () => {
    const zip64Extra = Buffer.alloc(4)
    zip64Extra.writeUInt16LE(0x0001, 0)
    zip64Extra.writeUInt16LE(0, 2)
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('x'), localOverride: { extraField: zip64Extra }, centralOverride: { extraField: zip64Extra } },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a data-descriptor flag is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), flags: 0x8 }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a duplicate local-header offset is rejected', async () => {
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('hello') },
      { name: 'b.txt', data: Buffer.from('world'), centralOverride: { relativeOffsetOfLocalHeader: 0 } },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('overlapping entry data ranges are rejected — entry A\'s declared (and equivalence-consistent) compressed size is inflated to reach into entry B\'s real local header', async () => {
    // Both entries must remain individually readable (a real local header at
    // the offset each central entry claims) for this to test the range/
    // overlap check specifically, rather than an earlier "invalid local
    // header signature" rejection from yauzl itself. Entry A's compressed
    // size is inflated identically in both its local and central copies
    // (so central/local equivalence still holds) just enough to push its
    // computed data-end past entry B's real start, while staying within the
    // whole archive's total byte length (so yauzl's own "file data overflows
    // file bounds" check does not fire first for a different reason).
    // method: 8 (DEFLATE) is required here — yauzl's own STORED-entry
    // self-consistency check (compressedSize must equal uncompressedSize
    // for method 0) would otherwise reject this fixture before this
    // module's own range/overlap check ever runs. A real DEFLATE stream is
    // self-terminating, so appending a few extra raw bytes to its declared
    // compressed span (as this inflation does) does not corrupt
    // decompression of the genuine content — inflate simply stops at the
    // real end-of-stream marker.
    const aData = Buffer.from('x')
    const bData = Buffer.from('y')
    const realCompressedSize = deflateRawSync(aData).length
    const inflatedCompressedSize = realCompressedSize + 5 // reaches 5 bytes into B's local header
    const zip = buildZip([
      {
        name: 'a.txt',
        data: aData,
        method: 8,
        localOverride: { compressedSize: inflatedCompressedSize },
        centralOverride: { compressedSize: inflatedCompressedSize },
      },
      { name: 'b.txt', data: bData },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('an entry declaring data that overlaps the central directory is rejected', async () => {
    // Same technique as the overlap test above: inflate entry A's declared
    // (and equivalence-consistent) compressed size just enough to push its
    // computed data-end past the real central-directory-offset, while the
    // EOCD's own centralDirectoryOffset is left honest — so yauzl can still
    // read the one real central-directory entry and hand it back to this
    // module for the overlap check to actually run.
    // method: 8 (DEFLATE) for the same reason as the overlap test above —
    // avoids yauzl's own STORED-only compressedSize===uncompressedSize
    // self-consistency check firing before this module's own check runs.
    const data = Buffer.from('x')
    const realCompressedSize = deflateRawSync(data).length
    const inflatedCompressedSize = realCompressedSize + 10 // reaches into the central directory bytes that follow
    const zip = buildZip([
      {
        name: 'a.txt',
        data,
        method: 8,
        localOverride: { compressedSize: inflatedCompressedSize },
        centralOverride: { compressedSize: inflatedCompressedSize },
      },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('exact-duplicate archive entry names are rejected', async () => {
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('hello') },
      { name: 'a.txt', data: Buffer.from('world') },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('ASCII case-fold colliding archive entry names are rejected', async () => {
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('hello') },
      { name: 'A.TXT', data: Buffer.from('world') },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a "../" traversal path is rejected', async () => {
    const zip = realZip('../evil.txt', Buffer.from('x'))
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a "./" path component is rejected', async () => {
    const zip = realZip('./a.txt', Buffer.from('x'))
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('an absolute path is rejected', async () => {
    const zip = realZip('/etc/passwd', Buffer.from('x'))
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a drive-letter path is rejected', async () => {
    const zip = realZip('C:/evil.txt', Buffer.from('x'))
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a backslash path is rejected', async () => {
    const zip = realZip('a\\b.txt', Buffer.from('x'))
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a NUL byte in a name is rejected', async () => {
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('x'), localOverride: { fileName: Buffer.from([0x61, 0x00, 0x62]) }, centralOverride: { fileName: Buffer.from([0x61, 0x00, 0x62]) } },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a non-ASCII raw archive filename is rejected', async () => {
    const nonAscii = Buffer.from([0xc3, 0xa9, 0x2e, 0x74, 0x78, 0x74]) // 'é.txt' in UTF-8
    const zip = buildZip([
      { name: 'placeholder.txt', data: Buffer.from('x'), localOverride: { fileName: nonAscii }, centralOverride: { fileName: nonAscii } },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('an empty interior path component is rejected', async () => {
    const zip = realZip('a//b.txt', Buffer.from('x'))
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a multi-disk archive is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x') }], { diskNumberOverride: 1 })
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a truncated local header is MALFORMED_WORKBOOK', async () => {
    const zip = realZip('a.txt', Buffer.from('hello'))
    const truncated = zip.subarray(0, 10) // cuts off mid local-header
    await expect(assertSafeXlsxArchive(new Uint8Array(truncated))).rejects.toMatchObject({ code: 'MALFORMED_WORKBOOK' })
  })

  it('a truncated compressed stream is rejected', async () => {
    const zip = realZip('a.txt', Buffer.from('hello world, this is more than a few bytes'), 8)
    // Truncate a few bytes out of the middle of the compressed payload region without touching the central directory/EOCD math would corrupt offsets;
    // instead corrupt the archive by shortening the whole buffer just past the local header, which yauzl/CRC will reject as inconsistent.
    const truncated = Buffer.concat([zip.subarray(0, 32), zip.subarray(40)])
    await expect(assertSafeXlsxArchive(new Uint8Array(truncated))).rejects.toBeInstanceOf(ArchiveGuardError)
  })

  it('materially trailing data after a well-formed archive is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x') }], { trailingGarbage: Buffer.from('unexpected trailing bytes') })
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'MALFORMED_WORKBOOK' })
  })

  it('a complete second archive concatenated after a first is REJECTED — R0\'s claim that this "resolves safely as just the second archive" was wrong and has been corrected (R1 remediation, Codex finding)', async () => {
    // R0's comment asserted this concatenation was safe because "both [this
    // module's EOCD search and yauzl's] independently find the SAME
    // (rightmost/trailing) EOCD" and therefore "agree the archive is just
    // b.txt". That claim was never actually verified against real bytes —
    // it is false. Verified during R1 remediation, directly and
    // independently:
    //
    //   - This module's own EOCD search DOES find the second archive's
    //     real, rightmost EOCD correctly (R0's claim was right about that
    //     much) — but the second archive's OWN central-directory-offset
    //     field was written assuming it starts at byte 0 of its own
    //     standalone file. Once a first archive's bytes are prepended, that
    //     declared offset no longer equals (this module's own
    //     independently-computed eocdOffset - centralDirectorySize): the
    //     central-directory extent invariant added in this remediation
    //     (Section 9/10) now correctly rejects exactly this mismatch, as
    //     UNSAFE_ARCHIVE, before yauzl is ever asked to open the buffer.
    //   - Called directly (bypassing this module, for evidence only): yauzl
    //     itself does NOT reject this — it happily proceeds using the
    //     second archive's un-adjusted offset, which (purely by coincidence
    //     of both test archives being built to an identical byte length in
    //     this specific construction) lands back inside the FIRST archive's
    //     own byte range and silently returns entries read from the wrong
    //     archive's data, with no error at all. This is the real, live
    //     divergent-interpretation risk this module exists to close — R0's
    //     "both agree" comment was an unverified assumption, not a fact.
    //
    // The corrected, evidence-based conclusion: this concatenation must be
    // (and now is) rejected. See the "leading bytes" test below for the
    // other half of Section 11's investigation.
    const first = buildZip([{ name: 'a.txt', data: Buffer.from('x') }])
    const second = buildZip([{ name: 'b.txt', data: Buffer.from('y') }])
    const concatenated = Buffer.concat([first, second])
    await expect(assertSafeXlsxArchive(new Uint8Array(concatenated))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('arbitrary leading bytes before an otherwise-valid, unmodified archive are rejected (self-extractor-style stub layout)', async () => {
    // A real self-extracting archive typically prepends a stub (e.g. an
    // EXE) in front of an otherwise complete, internally-self-consistent
    // ZIP without rewriting any of the ZIP's own internal offsets — a
    // well-behaved universal ZIP reader is expected to compute a base-
    // offset adjustment by cross-referencing the found EOCD position
    // against the ZIP's own declared (pre-stub) central-directory offset.
    // Verified directly during R1 remediation: yauzl performs NO such
    // adjustment — it takes the declared centralDirectoryOffset literally
    // as an absolute position in the buffer it was given, and fails
    // outright ("invalid central directory file header signature") once
    // leading bytes shift that position. This module's own central-
    // directory extent invariant independently rejects the same bytes
    // first, before yauzl is ever invoked, for the identical structural
    // reason as the concatenation case above: the declared
    // centralDirectoryOffset no longer equals (eocdOffset -
    // centralDirectorySize) once leading bytes are prepended. Both facts
    // corroborate the same conclusion; this module's own check is what
    // actually produces the rejection in production, since it always runs
    // before yauzl is given the bytes at all.
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x') }])
    const withLeadingStub = Buffer.concat([Buffer.alloc(64, 0x41), zip])
    await expect(assertSafeXlsxArchive(new Uint8Array(withLeadingStub))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  // Multiple/ambiguous EOCD signatures (Section 11, case D): not separately
  // constructible under this contract. A decoy EOCD signature could only
  // plausibly hide inside a real archive's own comment region — but this
  // module's zero-length-comment policy (archiveCommentBytes: 0) already
  // rejects any archive with a nonzero comment outright, and any bytes
  // appended after a real, honest, zero-comment archive are exactly the
  // "materially trailing data" scenario already covered and rejected above
  // (via the comment-length/actual-trailing-bytes consistency check in
  // parseEndOfCentralDirectory). There is no way to construct a "multiple
  // EOCD" ambiguity under this narrow contract that isn't already one of
  // the two cases covered by dedicated tests elsewhere in this file — no
  // separate test is added for this case, per Section 11's "where safely
  // constructible" qualifier.
})

describe('general-purpose flag policy (R1 remediation, Codex blocker #1)', () => {
  it('valid, all-zero flags are accepted for both STORED and DEFLATE entries', async () => {
    const stored = buildZip([{ name: 'a.txt', data: Buffer.from('x'), method: 0 }])
    await expect(assertSafeXlsxArchive(new Uint8Array(stored))).resolves.toBeUndefined()
    const deflated = buildZip([{ name: 'a.txt', data: Buffer.from('hello world'), method: 8 }])
    await expect(assertSafeXlsxArchive(new Uint8Array(deflated))).resolves.toBeUndefined()
  })

  it('0x2000 (masking of values) agreeing between central and local headers is rejected — the exact bypass Codex independently proved against R0', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), flags: 0x2000 }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('0x2000 set ONLY on the local header (central header flags remain 0) is independently rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), localOverride: { generalPurposeBitFlag: 0x2000 } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('0x2000 set ONLY on the central header (local header flags remain 0) is independently rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), centralOverride: { generalPurposeBitFlag: 0x2000 } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('0x0040 (strong encryption) is rejected by THIS module as UNSAFE_ARCHIVE — not merely left to fall through to yauzl/CFB behavior', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), flags: 0x0040 }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('encryption (0x0001) is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), method: 8, flags: 0x0001 }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a trailing data descriptor (0x0008) is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), flags: 0x0008 }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('an unknown/unnamed disallowed flag bit fails closed — the generic allow-mask check, not a named one-off check, is what catches it', async () => {
    // 0x0400 (bit 10) is reserved/unused by the ZIP spec and has no named
    // check anywhere in this module — it is caught purely because it is
    // not part of KNOWN_ALLOWED_GENERAL_PURPOSE_FLAGS (0x0000).
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), flags: 0x0400 }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })
})

describe('local ZIP64 extra field (R1 remediation, Codex blocker #2)', () => {
  const zip64Extra = (() => {
    const buf = Buffer.alloc(4)
    buf.writeUInt16LE(0x0001, 0)
    buf.writeUInt16LE(0, 2) // zero-length payload
    return buf
  })()

  it('a ZIP64 extra field present ONLY on the local header (central extra field is empty) is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), localOverride: { extraField: zip64Extra } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('an empty-payload local ZIP64 extra field is rejected — presence of the id alone is the violation, independent of payload content', async () => {
    // zip64Extra above already has a zero-length payload; this test exists
    // to name that fact explicitly per Section 6's requirement.
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), localOverride: { extraField: zip64Extra } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a ZIP64 extra field present ONLY on the central header (local extra field is empty) is independently rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), centralOverride: { extraField: zip64Extra } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a malformed/truncated local extra field (declared data size exceeds the buffer) is MALFORMED_WORKBOOK', async () => {
    // header id (2 bytes) + declared dataSize=100 (2 bytes), but zero actual
    // payload bytes follow — yauzl's own parseExtraFields throws on this.
    const truncated = Buffer.alloc(4)
    truncated.writeUInt16LE(0x9999, 0) // some unrelated, made-up id
    truncated.writeUInt16LE(100, 2) // declares 100 payload bytes that don't exist
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), localOverride: { extraField: truncated } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'MALFORMED_WORKBOOK' })
  })

  it('a local extra field with trailing bytes too short to form a complete field header is MALFORMED_WORKBOOK — stricter than yauzl\'s own silent-padding tolerance', async () => {
    // A single well-formed field (id+size+0-byte payload = 4 bytes) followed
    // by 2 stray bytes that cannot form another complete 4-byte header.
    // yauzl's own parseExtraFields would silently stop and return one field
    // without erroring; this module's stricter framing-consumption check
    // rejects the leftover bytes instead.
    const wellFormed = Buffer.alloc(4)
    wellFormed.writeUInt16LE(0x9999, 0)
    wellFormed.writeUInt16LE(0, 2)
    const withStrayBytes = Buffer.concat([wellFormed, Buffer.from([0xaa, 0xbb])])
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), localOverride: { extraField: withStrayBytes } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'MALFORMED_WORKBOOK' })
  })

  it('a normal, non-ZIP64 local extra field (well-formed, fully consumed) is accepted', async () => {
    const extendedTimestamp = Buffer.alloc(9)
    extendedTimestamp.writeUInt16LE(0x5455, 0) // "extended timestamp" — a real, common, benign extra field id
    extendedTimestamp.writeUInt16LE(5, 2)
    extendedTimestamp.writeUInt8(0x01, 4)
    extendedTimestamp.writeUInt32LE(0, 5)
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), localOverride: { extraField: extendedTimestamp } }])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).resolves.toBeUndefined()
  })

  it('central ZIP64 remains rejected when the local header also independently carries it (regression: pre-existing R0 behavior preserved)', async () => {
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('x'), localOverride: { extraField: zip64Extra }, centralOverride: { extraField: zip64Extra } },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })
})

describe('EOCD single-disk fields (R1 remediation, IMPORTANT finding)', () => {
  it('central-directory-start-disk != 0 is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x') }], { centralDirectoryStartDiskOverride: 1 })
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('entries-on-this-disk != total entry count is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x') }], { entriesOnThisDiskOverride: 0 })
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('valid single-disk EOCD field values (disk=0, central-directory-start-disk=0, entries-on-this-disk==total) are accepted', async () => {
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('x') },
      { name: 'b.txt', data: Buffer.from('y') },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).resolves.toBeUndefined()
  })
})

describe('central-directory size / extent invariant (R1 remediation, IMPORTANT finding)', () => {
  it('the exact offset+size==eocdOffset relationship holds for, and is accepted on, a genuinely valid archive (regression control)', async () => {
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('x') },
      { name: 'b.txt', data: Buffer.from('y') },
    ])
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).resolves.toBeUndefined()
  })

  it('a declared central-directory size one byte too SMALL (leaves a gap before the EOCD) is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x') }])
    // Determine the real size by re-deriving it: rebuild without override and
    // diff isn't available here, so instead directly assert the smallest
    // possible corruption — decrementing by 1 relative to the correct value
    // computed by the builder's own default (no override) means we must
    // supply an explicit override smaller than that default. We do this by
    // reading back the real value the builder would have used: the archive's
    // own un-overridden EOCD central-directory-size field, minus one.
    const realSize = zip.readUInt32LE(zip.length - 22 + 12)
    const corrupted = buildZip([{ name: 'a.txt', data: Buffer.from('x') }], { centralDirectorySizeOverride: realSize - 1 })
    await expect(assertSafeXlsxArchive(new Uint8Array(corrupted))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('a declared central-directory size one byte too LARGE (overlaps into the EOCD record itself) is rejected', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x') }])
    const realSize = zip.readUInt32LE(zip.length - 22 + 12)
    const corrupted = buildZip([{ name: 'a.txt', data: Buffer.from('x') }], { centralDirectorySizeOverride: realSize + 1 })
    await expect(assertSafeXlsxArchive(new Uint8Array(corrupted))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })

  it('an extreme, near-uint32-max declared central-directory size (representable but grossly out of bounds) is rejected via the explicit bounds check', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x') }], { centralDirectorySizeOverride: 0xfffffff0 })
    await expect(assertSafeXlsxArchive(new Uint8Array(zip))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
  })
})

describe('call order / SheetJS non-invocation proof', () => {
  let readSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    readSpy = vi.spyOn(xlsxAdapter, 'read')
  })
  afterEach(() => {
    readSpy.mockRestore()
  })

  function buildRealXlsx(): Buffer {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2]]), 'Sheet1')
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  }

  it('inspectWorkbook: a rejected archive never reaches XLSX.read', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x') }], { comment: Buffer.from('hi') })
    await expect(inspectWorkbook(new Uint8Array(zip), { filename: 'book.xlsx' })).rejects.toMatchObject({
      code: 'UNSAFE_ARCHIVE',
    })
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('decodeWorksheet: a rejected archive never reaches XLSX.read', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x') }], { comment: Buffer.from('hi') })
    await expect(decodeWorksheet(new Uint8Array(zip), { filename: 'book.xlsx' }, { index: 0 })).rejects.toMatchObject({
      code: 'UNSAFE_ARCHIVE',
    })
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('inspectWorkbook: an encrypted-entry archive never reaches XLSX.read', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), method: 8, flags: 0x1 }])
    await expect(inspectWorkbook(new Uint8Array(zip), { filename: 'book.xlsx' })).rejects.toMatchObject({
      code: 'UNSAFE_ARCHIVE',
    })
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('decodeWorksheet: an archive exceeding the default entry-count cap never reaches XLSX.read', async () => {
    // DecodeWorksheetOptions/InspectWorkbookOptions expose no archive-guard
    // limits override (only WorkbookLimits) — the guard always runs with
    // DEFAULT_ARCHIVE_LIMITS from these public entry points, by design. So
    // exercising this rejection through the real public API means building
    // a real archive past the true default cap (1000), not an injected one.
    const entries = []
    for (let i = 0; i <= DEFAULT_ARCHIVE_LIMITS.maxArchiveEntryCount; i++) entries.push({ name: `f${i}.txt`, data: Buffer.from('x') })
    const zip = buildZip(entries)
    await expect(decodeWorksheet(new Uint8Array(zip), { filename: 'book.xlsx' }, { index: 0 })).rejects.toMatchObject({
      code: 'ARCHIVE_LIMIT_EXCEEDED',
      details: { limit: 'maxArchiveEntryCount' },
    })
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('inspectWorkbook: a 0x2000-flagged archive never reaches XLSX.read (R1 remediation)', async () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), flags: 0x2000 }])
    await expect(inspectWorkbook(new Uint8Array(zip), { filename: 'book.xlsx' })).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' })
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('decodeWorksheet: a local-only-ZIP64-extra-field archive never reaches XLSX.read (R1 remediation)', async () => {
    const zip64Extra = Buffer.alloc(4)
    zip64Extra.writeUInt16LE(0x0001, 0)
    zip64Extra.writeUInt16LE(0, 2)
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('x'), localOverride: { extraField: zip64Extra } }])
    await expect(decodeWorksheet(new Uint8Array(zip), { filename: 'book.xlsx' }, { index: 0 })).rejects.toMatchObject({
      code: 'UNSAFE_ARCHIVE',
    })
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('positive control: a valid archive DOES reach XLSX.read via inspectWorkbook', async () => {
    const buf = buildRealXlsx()
    await expect(inspectWorkbook(new Uint8Array(buf), { filename: 'book.xlsx' })).resolves.toMatchObject({ format: 'xlsx' })
    expect(readSpy).toHaveBeenCalled()
  })

  it('positive control: a valid archive DOES reach XLSX.read via decodeWorksheet', async () => {
    const buf = buildRealXlsx()
    await expect(decodeWorksheet(new Uint8Array(buf), { filename: 'book.xlsx' }, { index: 0 })).resolves.toMatchObject({
      index: 0,
    })
    expect(readSpy).toHaveBeenCalled()
  })

  it('xls is never subjected to the archive guard (BIFF8 is not a ZIP archive) — XLSX.read is still called', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a'], [1]]), 'S')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer
    await expect(inspectWorkbook(new Uint8Array(buf), { filename: 'legacy.xls' })).resolves.toMatchObject({ format: 'xls' })
    expect(readSpy).toHaveBeenCalled()
  })

  it('csv never invokes the archive guard or XLSX.read at all', async () => {
    const bytes = new Uint8Array(Buffer.from('a,b\n1,2\n'))
    await expect(inspectWorkbook(bytes, { filename: 'x.csv' })).resolves.toMatchObject({ format: 'csv' })
    expect(readSpy).not.toHaveBeenCalled()
  })
})

describe('async contract', () => {
  it('assertSafeXlsxArchive returns a genuine Promise', () => {
    const zip = realZip('a.txt', Buffer.from('x'))
    const result = assertSafeXlsxArchive(new Uint8Array(zip))
    expect(result).toBeInstanceOf(Promise)
    return result
  })

  it('inspectWorkbook and decodeWorksheet return genuine Promises for xlsx input', () => {
    const buf = buildZip([{ name: 'a.txt', data: Buffer.from('x') }])
    const r1 = inspectWorkbook(new Uint8Array(buf), { filename: 'book.xlsx' })
    const r2 = decodeWorksheet(new Uint8Array(buf), { filename: 'book.xlsx' }, { index: 0 })
    expect(r1).toBeInstanceOf(Promise)
    expect(r2).toBeInstanceOf(Promise)
    // Both are expected to reject (not a real workbook) — swallow to avoid an unhandled rejection warning.
    return Promise.allSettled([r1, r2])
  })
})
