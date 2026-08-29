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

  it('a complete second archive concatenated after a first is safely and consistently interpreted as just the second archive — not a divergent-parser bypass', async () => {
    // This module's EOCD search and yauzl's own EOCD search use the same
    // backward-scan-for-signature algorithm, so both independently find the
    // SAME (rightmost/trailing) EOCD here — the second archive's own,
    // completely valid one. Both therefore agree the archive is just
    // "b.txt", and yauzl only ever reads central-directory entries starting
    // from that agreed offset onward — the first archive's bytes are inert,
    // unreachable padding before it, never decompressed or trusted by
    // either interpretation. This is empirically NOT the divergent-
    // interpretation risk this module's EOCD-agreement cross-check exists
    // to close (see the "materially trailing GARBAGE" test above, which IS
    // rejected, precisely because trailing bytes that are NOT themselves a
    // complete, self-consistent archive break the comment-length
    // consistency check).
    const first = buildZip([{ name: 'a.txt', data: Buffer.from('x') }])
    const second = buildZip([{ name: 'b.txt', data: Buffer.from('y') }])
    const concatenated = Buffer.concat([first, second])
    await expect(assertSafeXlsxArchive(new Uint8Array(concatenated))).resolves.toBeUndefined()
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
