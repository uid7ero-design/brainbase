import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'
import {
  inspectWorkbook,
  decodeWorksheet,
  WorkbookParserError,
  DEFAULT_WORKBOOK_LIMITS,
} from '@/lib/data-hub/workbookParser'

type SheetSpec = { name: string; rows: unknown[][]; hidden?: 0 | 1 | 2 }

function buildSpreadsheet(sheets: SheetSpec[], bookType: 'xlsx' | 'biff8'): Buffer {
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows)
    XLSX.utils.book_append_sheet(wb, ws, sheet.name)
  }
  wb.Workbook = { Sheets: sheets.map(s => ({ Hidden: s.hidden ?? 0 })) }
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer
}

function toBytes(buf: Buffer): Uint8Array {
  return new Uint8Array(buf)
}

// Hand-rolled CRC32 (IEEE 802.3 / the ZIP checksum) so buildMinimalValidZip
// needs no dependency beyond what's already installed. Verified against
// Node's own zlib.crc32 during development (only available in Node 21+, so
// not usable directly here since CI pins Node 20).
let crc32Table: Uint32Array | undefined

function crc32(buf: Buffer): number {
  if (!crc32Table) {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      t[n] = c >>> 0
    }
    crc32Table = t
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = crc32Table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// Builds a genuinely valid, standards-compliant single-entry ZIP archive
// (stored/uncompressed) from scratch — a real local file header, central
// directory header, and end-of-central-directory record. Independently
// verified during development to extract correctly with Windows' native
// Expand-Archive. Used to prove that a real ZIP lacking OOXML parts is
// rejected by structural recognition, not merely by malformed-byte
// detection.
function buildMinimalValidZip(entryName: string, content: string): Buffer {
  const nameBuf = Buffer.from(entryName, 'ascii')
  const dataBuf = Buffer.from(content, 'utf8')
  const crc = crc32(dataBuf)

  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(10, 4)
  localHeader.writeUInt16LE(0, 6)
  localHeader.writeUInt16LE(0, 8)
  localHeader.writeUInt16LE(0, 10)
  localHeader.writeUInt16LE(0x21, 12)
  localHeader.writeUInt32LE(crc, 14)
  localHeader.writeUInt32LE(dataBuf.length, 18)
  localHeader.writeUInt32LE(dataBuf.length, 22)
  localHeader.writeUInt16LE(nameBuf.length, 26)
  localHeader.writeUInt16LE(0, 28)
  const localEntry = Buffer.concat([localHeader, nameBuf, dataBuf])

  const centralHeader = Buffer.alloc(46)
  centralHeader.writeUInt32LE(0x02014b50, 0)
  centralHeader.writeUInt16LE(20, 4)
  centralHeader.writeUInt16LE(10, 6)
  centralHeader.writeUInt16LE(0, 8)
  centralHeader.writeUInt16LE(0, 10)
  centralHeader.writeUInt16LE(0, 12)
  centralHeader.writeUInt16LE(0x21, 14)
  centralHeader.writeUInt32LE(crc, 16)
  centralHeader.writeUInt32LE(dataBuf.length, 20)
  centralHeader.writeUInt32LE(dataBuf.length, 24)
  centralHeader.writeUInt16LE(nameBuf.length, 28)
  centralHeader.writeUInt16LE(0, 30)
  centralHeader.writeUInt16LE(0, 32)
  centralHeader.writeUInt16LE(0, 34)
  centralHeader.writeUInt16LE(0, 36)
  centralHeader.writeUInt32LE(0, 38)
  centralHeader.writeUInt32LE(0, 42)
  const centralEntry = Buffer.concat([centralHeader, nameBuf])

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(centralEntry.length, 12)
  eocd.writeUInt32LE(localEntry.length, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([localEntry, centralEntry, eocd])
}

describe('inspectWorkbook / decodeWorksheet — CSV', () => {
  it('1. valid CSV: headers, row order, bounded preview', () => {
    const csv = 'name,amount\nAlice,10\nBob,20\nCarol,30\n'
    const bytes = toBytes(Buffer.from(csv, 'utf8'))
    const inspection = inspectWorkbook(bytes, { filename: 'data.csv' })
    expect(inspection.format).toBe('csv')
    expect(inspection.worksheets).toHaveLength(1)
    const [sheet] = inspection.worksheets
    expect(sheet.index).toBe(0)
    expect(sheet.visibility).toBe('visible')
    expect(sheet.headers).toEqual(['name', 'amount'])
    expect(sheet.previewRows).toEqual([['Alice', '10'], ['Bob', '20'], ['Carol', '30']])
    expect(sheet.previewTruncated).toBe(false)

    const decoded = decodeWorksheet(bytes, { filename: 'data.csv' }, { index: 0 })
    expect(decoded.headers).toEqual(['name', 'amount'])
    expect(decoded.rows).toEqual([['Alice', '10'], ['Bob', '20'], ['Carol', '30']])
    expect(decoded.rowCount).toBe(3)
    expect(decoded.columnCount).toBe(2)
  })

  it('2. quoted CSV: embedded comma, quote, CRLF, BOM', () => {
    const csv =
      '﻿name,note\r\n' +
      '"Smith, John","Says ""hi"""\r\n' +
      'Plain,ok\r\n'
    const bytes = toBytes(Buffer.from(csv, 'utf8'))
    const decoded = decodeWorksheet(bytes, { filename: 'quoted.csv' }, { index: 0 })
    expect(decoded.headers).toEqual(['name', 'note'])
    expect(decoded.rows).toEqual([
      ['Smith, John', 'Says "hi"'],
      ['Plain', 'ok'],
    ])
  })

  it('6 (CSV variant). out-of-range index on CSV is WORKSHEET_NOT_FOUND, never a fallback to sheet 0', () => {
    const bytes = toBytes(Buffer.from('a,b\n1,2\n', 'utf8'))
    let error: unknown
    try {
      decodeWorksheet(bytes, { filename: 'data.csv' }, { index: 1 })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).code).toBe('WORKSHEET_NOT_FOUND')
  })

  it('17. malformed/binary CSV rejected', () => {
    const bytes = toBytes(Buffer.from([0x61, 0x00, 0x62, 0x2c, 0x63]))
    let error: unknown
    try {
      inspectWorkbook(bytes, { filename: 'binary.csv' })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).code).toBe('INVALID_FILE_SIGNATURE')
  })
})

describe('inspectWorkbook / decodeWorksheet — XLSX', () => {
  it('3. valid multi-sheet XLSX preserves exact worksheet order', () => {
    const buf = buildSpreadsheet(
      [
        { name: 'Alpha', rows: [['h'], [1]] },
        { name: 'Beta', rows: [['h'], [2]] },
        { name: 'Gamma', rows: [['h'], [3]] },
      ],
      'xlsx'
    )
    const inspection = inspectWorkbook(toBytes(buf), { filename: 'book.xlsx' })
    expect(inspection.format).toBe('xlsx')
    expect(inspection.worksheets.map(w => w.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(inspection.worksheets.map(w => w.index)).toEqual([0, 1, 2])
  })

  it('5. exact selection by zero-based index, not name', () => {
    const buf = buildSpreadsheet(
      [
        { name: 'First', rows: [['h'], ['a']] },
        { name: 'Second', rows: [['h'], ['b']] },
      ],
      'xlsx'
    )
    const decoded = decodeWorksheet(toBytes(buf), { filename: 'book.xlsx' }, { index: 1 })
    expect(decoded.index).toBe(1)
    expect(decoded.name).toBe('Second')
    expect(decoded.rows).toEqual([['b']])
  })

  it('6. out-of-range index returns WORKSHEET_NOT_FOUND, never falls back to sheet 0', () => {
    const buf = buildSpreadsheet([{ name: 'Only', rows: [['h'], [1]] }], 'xlsx')
    let error: unknown
    try {
      decodeWorksheet(toBytes(buf), { filename: 'book.xlsx' }, { index: 5 })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).code).toBe('WORKSHEET_NOT_FOUND')
    expect((error as WorkbookParserError).details?.worksheetIndex).toBe(5)
  })

  it('7. visible / hidden / very-hidden reporting', () => {
    const buf = buildSpreadsheet(
      [
        { name: 'Vis', rows: [['h'], [1]], hidden: 0 },
        { name: 'Hid', rows: [['h'], [1]], hidden: 1 },
        { name: 'VeryHid', rows: [['h'], [1]], hidden: 2 },
      ],
      'xlsx'
    )
    const inspection = inspectWorkbook(toBytes(buf), { filename: 'book.xlsx' })
    expect(inspection.worksheets.map(w => w.visibility)).toEqual(['visible', 'hidden', 'veryHidden'])

    const decodedHidden = decodeWorksheet(toBytes(buf), { filename: 'book.xlsx' }, { index: 1 })
    expect(decodedHidden.visibility).toBe('hidden')
  })

  it('8. empty worksheet reporting', () => {
    const wb = XLSX.utils.book_new()
    const emptyWs = XLSX.utils.aoa_to_sheet([[]])
    const dataWs = XLSX.utils.aoa_to_sheet([['h'], [1]])
    XLSX.utils.book_append_sheet(wb, emptyWs, 'Empty')
    XLSX.utils.book_append_sheet(wb, dataWs, 'Data')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const inspection = inspectWorkbook(toBytes(buf), { filename: 'book.xlsx' })
    expect(inspection.worksheets[0].isEmpty).toBe(true)
    expect(inspection.worksheets[1].isEmpty).toBe(false)
  })

  it('9. bounded preview never exceeds the configured size, and previewTruncated is true when there is more data', () => {
    const rows: unknown[][] = [['h']]
    for (let i = 0; i < 25; i++) rows.push([i])
    const buf = buildSpreadsheet([{ name: 'Big', rows }], 'xlsx')

    const inspection = inspectWorkbook(toBytes(buf), { filename: 'book.xlsx' }, { previewRowCount: 5 })
    const [sheet] = inspection.worksheets
    expect(sheet.previewRows).toHaveLength(5)
    expect(sheet.previewTruncated).toBe(true)

    const smallBuf = buildSpreadsheet([{ name: 'Small', rows: [['h'], [1], [2]] }], 'xlsx')
    const smallInspection = inspectWorkbook(toBytes(smallBuf), { filename: 'book.xlsx' }, { previewRowCount: 5 })
    expect(smallInspection.worksheets[0].previewTruncated).toBe(false)
    expect(smallInspection.worksheets[0].previewRows).toHaveLength(2)
  })

  it('10. selected-sheet row-limit rejection using a tiny injected limit', () => {
    const rows: unknown[][] = [['h']]
    for (let i = 0; i < 10; i++) rows.push([i])
    const buf = buildSpreadsheet([{ name: 'Rows', rows }], 'xlsx')

    let error: unknown
    try {
      decodeWorksheet(
        toBytes(buf),
        { filename: 'book.xlsx' },
        { index: 0 },
        { limits: { maxSelectedWorksheetRows: 3 } }
      )
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).code).toBe('WORKSHEET_LIMIT_EXCEEDED')
    expect((error as WorkbookParserError).details?.limit).toBe('maxSelectedWorksheetRows')
  })

  it('11. column limit and materialized-cell limit rejection using tiny injected limits', () => {
    const buf = buildSpreadsheet(
      [{ name: 'Wide', rows: [['a', 'b', 'c', 'd'], [1, 2, 3, 4]] }],
      'xlsx'
    )
    let columnError: unknown
    try {
      decodeWorksheet(
        toBytes(buf),
        { filename: 'book.xlsx' },
        { index: 0 },
        { limits: { maxSelectedWorksheetColumns: 2 } }
      )
    } catch (err) {
      columnError = err
    }
    expect((columnError as WorkbookParserError).code).toBe('WORKSHEET_LIMIT_EXCEEDED')
    expect((columnError as WorkbookParserError).details?.limit).toBe('maxSelectedWorksheetColumns')

    let cellError: unknown
    try {
      decodeWorksheet(
        toBytes(buf),
        { filename: 'book.xlsx' },
        { index: 0 },
        { limits: { maxSelectedWorksheetCells: 2 } }
      )
    } catch (err) {
      cellError = err
    }
    expect((cellError as WorkbookParserError).code).toBe('WORKSHEET_LIMIT_EXCEEDED')
    expect((cellError as WorkbookParserError).details?.limit).toBe('maxSelectedWorksheetCells')
  })

  it('12. worksheet-count limit rejection using a tiny injected limit', () => {
    const buf = buildSpreadsheet(
      [
        { name: 'One', rows: [['h'], [1]] },
        { name: 'Two', rows: [['h'], [1]] },
        { name: 'Three', rows: [['h'], [1]] },
      ],
      'xlsx'
    )
    let error: unknown
    try {
      inspectWorkbook(toBytes(buf), { filename: 'book.xlsx' }, { limits: { maxWorksheetCount: 2 } })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).code).toBe('WORKBOOK_LIMIT_EXCEEDED')
    expect((error as WorkbookParserError).details?.limit).toBe('maxWorksheetCount')

    let decodeError: unknown
    try {
      decodeWorksheet(
        toBytes(buf),
        { filename: 'book.xlsx' },
        { index: 0 },
        { limits: { maxWorksheetCount: 2 } }
      )
    } catch (err) {
      decodeError = err
    }
    expect((decodeError as WorkbookParserError).code).toBe('WORKBOOK_LIMIT_EXCEEDED')
  })

  it('13. SHA-256 is deterministic and a single changed byte changes the digest', () => {
    const buf = buildSpreadsheet([{ name: 'S', rows: [['h'], [1]] }], 'xlsx')
    const bytes = toBytes(buf)
    const inspectionA = inspectWorkbook(bytes, { filename: 'book.xlsx' })
    const inspectionB = inspectWorkbook(bytes, { filename: 'book.xlsx' })
    expect(inspectionA.sha256).toBe(inspectionB.sha256)
    expect(inspectionA.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))

    const mutated = Buffer.from(buf)
    mutated[mutated.length - 1] = mutated[mutated.length - 1] ^ 0xff
    const inspectionC = inspectWorkbook(toBytes(mutated), { filename: 'book.xlsx' })
    expect(inspectionC.sha256).not.toBe(inspectionA.sha256)
  })

  it('14. extension/signature mismatch is rejected', () => {
    const buf = buildSpreadsheet([{ name: 'S', rows: [['h'], [1]] }], 'xlsx')
    let error: unknown
    try {
      // Real xlsx bytes, but filename claims .xls — must fail on OLE signature check.
      inspectWorkbook(toBytes(buf), { filename: 'mislabeled.xls' })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).code).toBe('INVALID_FILE_SIGNATURE')
  })

  it('15. a genuinely valid ZIP (not OOXML) renamed .xlsx is rejected, not silently accepted', () => {
    // buildMinimalValidZip produces a real, standards-compliant single-entry
    // stored ZIP (independently verified against Windows' native ZIP
    // extractor during development — not just bytes that merely start with
    // the ZIP signature). It has none of the required OOXML parts
    // ([Content_Types].xml, xl/workbook.xml, ...), so it must be rejected by
    // structural recognition, proving that rejection path is real and not
    // just "malformed bytes in general".
    const validNonWorkbookZip = buildMinimalValidZip('hello.txt', 'hello world, this is not a workbook')
    let error: unknown
    try {
      inspectWorkbook(toBytes(validNonWorkbookZip), { filename: 'fake.xlsx' })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).code).toBe('MALFORMED_WORKBOOK')
  })

  it('16. malformed/truncated XLSX is MALFORMED_WORKBOOK', () => {
    const buf = buildSpreadsheet([{ name: 'S', rows: [['h'], [1], [2], [3]] }], 'xlsx')
    const truncated = buf.subarray(0, Math.floor(buf.length / 2))
    let error: unknown
    try {
      inspectWorkbook(toBytes(Buffer.from(truncated)), { filename: 'truncated.xlsx' })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).code).toBe('MALFORMED_WORKBOOK')
  })

  it('18. formula content is not recomputed', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([['label', 'val']])
    ws['A2'] = { t: 's', v: 'row1' }
    // Cached value (999) deliberately disagrees with what evaluating the
    // formula (1+1) would produce, to prove no recomputation happens.
    ws['B2'] = { t: 'n', v: 999, f: '1+1' }
    ws['!ref'] = 'A1:B2'
    XLSX.utils.book_append_sheet(wb, ws, 'Formulas')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const decoded = decodeWorksheet(toBytes(buf), { filename: 'book.xlsx' }, { index: 0 })
    expect(decoded.rows[0]).toEqual(['row1', 999])
  })

  it('declared range is exposed as metadata, not asserted as an actual populated count', () => {
    const rows: unknown[][] = [['h']]
    for (let i = 0; i < 3; i++) rows.push([i])
    const buf = buildSpreadsheet([{ name: 'S', rows }], 'xlsx')
    const inspection = inspectWorkbook(toBytes(buf), { filename: 'book.xlsx' })
    expect(inspection.worksheets[0].declaredRangeRows).toBe(4) // header + 3 rows
    expect(inspection.worksheets[0].declaredRangeColumns).toBe(1)
  })
})

describe('inspectWorkbook / decodeWorksheet — legacy XLS', () => {
  it('4. valid XLS: inventory + selected-sheet decoding', () => {
    const buf = buildSpreadsheet(
      [
        { name: 'One', rows: [['h'], ['a']] },
        { name: 'Two', rows: [['h'], ['b']] },
      ],
      'biff8'
    )
    const inspection = inspectWorkbook(toBytes(buf), { filename: 'legacy.xls' })
    expect(inspection.format).toBe('xls')
    expect(inspection.worksheets.map(w => w.name)).toEqual(['One', 'Two'])

    const decoded = decodeWorksheet(toBytes(buf), { filename: 'legacy.xls' }, { index: 1 })
    expect(decoded.name).toBe('Two')
    expect(decoded.rows).toEqual([['b']])
  })
})

describe('WorkbookInput / MIME handling', () => {
  it('unsupported extension is rejected regardless of MIME', () => {
    const bytes = toBytes(Buffer.from('irrelevant'))
    let error: unknown
    try {
      inspectWorkbook(bytes, { filename: 'report.pdf', mimeType: 'text/csv' })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).code).toBe('UNSUPPORTED_FILE_TYPE')
  })

  it('a lying MIME type does not change how a correctly-named CSV is parsed', () => {
    const bytes = toBytes(Buffer.from('a,b\n1,2\n'))
    const inspection = inspectWorkbook(bytes, { filename: 'data.csv', mimeType: 'application/vnd.ms-excel' })
    expect(inspection.format).toBe('csv')
  })
})

describe('default limits', () => {
  it('exposes the approved 5A.1 default constants', () => {
    expect(DEFAULT_WORKBOOK_LIMITS).toEqual({
      maxOriginalBytes: 20 * 1024 * 1024,
      maxWorksheetCount: 50,
      maxSelectedWorksheetRows: 100_000,
      maxSelectedWorksheetColumns: 1_000,
      maxSelectedWorksheetCells: 2_000_000,
    })
  })

  it('the overall file-size limit rejects an oversized buffer before any parsing is attempted', () => {
    const bytes = new Uint8Array(10)
    let error: unknown
    try {
      inspectWorkbook(bytes, { filename: 'huge.csv' }, { limits: { maxOriginalBytes: 5 } })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).code).toBe('WORKBOOK_LIMIT_EXCEEDED')
    expect((error as WorkbookParserError).details?.limit).toBe('maxOriginalBytes')
  })
})

describe('remediation: numeric option validation', () => {
  const validCsv = toBytes(Buffer.from('a,b\n1,2\n'))

  it('rejects NaN in a workload limit as a RangeError, not a WorkbookParserError', () => {
    expect(() =>
      inspectWorkbook(validCsv, { filename: 'x.csv' }, { limits: { maxWorksheetCount: NaN } })
    ).toThrow(RangeError)
  })

  it('rejects Infinity in a workload limit (it must not be usable to disable a bound)', () => {
    expect(() =>
      decodeWorksheet(validCsv, { filename: 'x.csv' }, { index: 0 }, { limits: { maxSelectedWorksheetRows: Infinity } })
    ).toThrow(RangeError)
  })

  it('rejects a negative workload limit', () => {
    expect(() =>
      inspectWorkbook(validCsv, { filename: 'x.csv' }, { limits: { maxOriginalBytes: -1 } })
    ).toThrow(RangeError)
  })

  it('rejects a fractional workload limit', () => {
    expect(() =>
      decodeWorksheet(validCsv, { filename: 'x.csv' }, { index: 0 }, { limits: { maxSelectedWorksheetColumns: 2.5 } })
    ).toThrow(RangeError)
  })

  it('rejects an unsafe-integer workload limit', () => {
    expect(() =>
      inspectWorkbook(validCsv, { filename: 'x.csv' }, { limits: { maxWorksheetCount: Number.MAX_SAFE_INTEGER + 2 } })
    ).toThrow(RangeError)
  })

  it('rejects a negative previewRowCount — this previously reached SheetJS as sheetRows: 0, which SheetJS treats as "unlimited"', () => {
    expect(() => inspectWorkbook(validCsv, { filename: 'x.csv' }, { previewRowCount: -1 })).toThrow(RangeError)
  })

  it('rejects a fractional previewRowCount', () => {
    expect(() => inspectWorkbook(validCsv, { filename: 'x.csv' }, { previewRowCount: 1.5 })).toThrow(RangeError)
  })

  it('previewRowCount: 0 is a deliberately supported contract — headers only, no preview rows, and it does not throw', () => {
    const inspection = inspectWorkbook(validCsv, { filename: 'x.csv' }, { previewRowCount: 0 })
    expect(inspection.worksheets[0].headers).toEqual(['a', 'b'])
    expect(inspection.worksheets[0].previewRows).toEqual([])
  })

  it('a RangeError from invalid options is never caught and reclassified as MALFORMED_WORKBOOK', () => {
    let error: unknown
    try {
      inspectWorkbook(validCsv, { filename: 'x.csv' }, { limits: { maxOriginalBytes: NaN } })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(RangeError)
    expect(error).not.toBeInstanceOf(WorkbookParserError)
  })
})

describe('remediation: ragged/sparse column and cell accounting', () => {
  it('a ragged CSV row wider than the header is not hidden by header-only column counting', () => {
    const csv = 'a,b\n1,2,3,4\n'
    const decoded = decodeWorksheet(toBytes(Buffer.from(csv)), { filename: 'ragged.csv' }, { index: 0 })
    expect(decoded.columnCount).toBe(4) // widest row, not headers.length (2)

    let error: unknown
    try {
      decodeWorksheet(
        toBytes(Buffer.from(csv)),
        { filename: 'ragged.csv' },
        { index: 0 },
        { limits: { maxSelectedWorksheetColumns: 3 } }
      )
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).code).toBe('WORKSHEET_LIMIT_EXCEEDED')
    expect((error as WorkbookParserError).details?.limit).toBe('maxSelectedWorksheetColumns')
    expect((error as WorkbookParserError).details?.actual).toBe(4)
  })

  it('sparse rows are counted by actual returned slots, not by an invented rectangle (rowCount x columnCount)', () => {
    // headers=3 wide, but each data row only has 1 real value.
    // Actual materialized cells = 3 (headers) + 1 + 1 = 5.
    // The old rowCount*columnCount formula would have said 2*3 = 6.
    const csv = 'a,b,c\n1\n2\n'
    const decoded = decodeWorksheet(
      toBytes(Buffer.from(csv)),
      { filename: 'sparse.csv' },
      { index: 0 },
      { limits: { maxSelectedWorksheetCells: 5 } }
    )
    expect(decoded.rows).toEqual([['1'], ['2']])

    // A limit of 4 must trip (5 > 4); a limit of 5 (tested above, no throw)
    // proves the accounting isn't inflated to 6 by a rectangular guess.
    let error: unknown
    try {
      decodeWorksheet(
        toBytes(Buffer.from(csv)),
        { filename: 'sparse.csv' },
        { index: 0 },
        { limits: { maxSelectedWorksheetCells: 4 } }
      )
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).details?.actual).toBe(5)
    expect((error as WorkbookParserError).details?.basis).toBe('materialized')
  })

  it('a wider row is counted at its actual width, proving the cell limit trips on real returned slots', () => {
    // headers=1, one row with 3 values -> materialized cells = 1 + 3 = 4.
    const csv = 'a\n1,2,3\n'
    let error: unknown
    try {
      decodeWorksheet(
        toBytes(Buffer.from(csv)),
        { filename: 'wide-row.csv' },
        { index: 0 },
        { limits: { maxSelectedWorksheetCells: 3 } }
      )
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).details?.actual).toBe(4)
  })

  it('the early declared-range rejection on an XLSX worksheet is labeled as a conservative preflight basis, distinct from the materialized basis', () => {
    const rows: unknown[][] = [['h']]
    for (let i = 0; i < 5; i++) rows.push([i])
    const buf = buildSpreadsheet([{ name: 'S', rows }], 'xlsx')
    let error: unknown
    try {
      decodeWorksheet(
        toBytes(buf),
        { filename: 'book.xlsx' },
        { index: 0 },
        { limits: { maxSelectedWorksheetRows: 2 } }
      )
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).details?.basis).toBe('declaredRange')
  })
})

describe('remediation: previewTruncated semantics', () => {
  it('exact preview boundary: exactly previewRowCount data rows is not truncated', () => {
    const rows: unknown[][] = [['h']]
    for (let i = 0; i < 5; i++) rows.push([i])
    const buf = buildSpreadsheet([{ name: 'S', rows }], 'xlsx')
    const inspection = inspectWorkbook(toBytes(buf), { filename: 'book.xlsx' }, { previewRowCount: 5 })
    expect(inspection.worksheets[0].previewRows).toHaveLength(5)
    expect(inspection.worksheets[0].previewTruncated).toBe(false)
  })

  it('preview boundary + 1: one row beyond the preview window is truncated', () => {
    const rows: unknown[][] = [['h']]
    for (let i = 0; i < 6; i++) rows.push([i])
    const buf = buildSpreadsheet([{ name: 'S', rows }], 'xlsx')
    const inspection = inspectWorkbook(toBytes(buf), { filename: 'book.xlsx' }, { previewRowCount: 5 })
    expect(inspection.worksheets[0].previewRows).toHaveLength(5)
    expect(inspection.worksheets[0].previewTruncated).toBe(true)
  })

  it('CSV previewTruncated is exact: false when there is truly no more data beyond the preview', () => {
    const csv = 'h\n1\n2\n3\n4\n5\n'
    const inspection = inspectWorkbook(toBytes(Buffer.from(csv)), { filename: 'x.csv' }, { previewRowCount: 5 })
    expect(inspection.worksheets[0].previewTruncated).toBe(false)
  })

  it('a distant declared cell can trip previewTruncated even with no additional real row inside the window — the documented conservative-signal caveat', () => {
    const ws = XLSX.utils.aoa_to_sheet([['h'], [1], [2]])
    // Force the declared range far past the real data, with nothing in between.
    ws['A50'] = { t: 'n', v: 999 }
    ws['!ref'] = 'A1:A50'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sparse')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const inspection = inspectWorkbook(toBytes(buf), { filename: 'book.xlsx' }, { previewRowCount: 5 })
    const [sheet] = inspection.worksheets
    // Only 2 real data rows exist inside (and beyond) the preview window,
    // but the declared range forces previewTruncated to true regardless —
    // proving it is a conservative signal, not proof of a real extra row.
    expect(sheet.previewRows.length).toBeLessThanOrEqual(5)
    expect(sheet.previewTruncated).toBe(true)
  })
})

describe('remediation: Date normalization', () => {
  it('a real XLSX date cell is returned as an ISO-8601 string, never a Date instance', () => {
    const ws = XLSX.utils.aoa_to_sheet([['when'], [new Date(Date.UTC(2024, 0, 15))]])
    ws['!ref'] = 'A1:A2'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Dates')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer

    const decoded = decodeWorksheet(toBytes(buf), { filename: 'dates.xlsx' }, { index: 0 })
    expect(decoded.rows[0][0]).toBe('2024-01-15T00:00:00.000Z')
    expect(decoded.rows[0][0]).not.toBeInstanceOf(Date)

    const inspection = inspectWorkbook(toBytes(buf), { filename: 'dates.xlsx' })
    expect(inspection.worksheets[0].previewRows[0][0]).toBe('2024-01-15T00:00:00.000Z')
  })

  it('ordinary strings/numbers/booleans/null are never stringified by the Date-normalization step', () => {
    const ws = XLSX.utils.aoa_to_sheet([['s', 'n', 'b'], ['hi', 42, true]])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Plain')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const decoded = decodeWorksheet(toBytes(buf), { filename: 'plain.xlsx' }, { index: 0 })
    expect(decoded.rows[0]).toEqual(['hi', 42, true])
  })
})

describe('remediation: additional boundary coverage', () => {
  it('empty CSV (header only, zero data rows)', () => {
    const decoded = decodeWorksheet(toBytes(Buffer.from('a,b\n')), { filename: 'empty.csv' }, { index: 0 })
    expect(decoded.rows).toEqual([])
    expect(decoded.rowCount).toBe(0)

    const inspection = inspectWorkbook(toBytes(Buffer.from('a,b\n')), { filename: 'empty.csv' })
    expect(inspection.worksheets[0].isEmpty).toBe(false) // header row is real declared content
  })

  it('a fully empty CSV file (zero rows at all) is reported as empty', () => {
    const inspection = inspectWorkbook(toBytes(Buffer.from('')), { filename: 'blank.csv' })
    expect(inspection.worksheets[0].isEmpty).toBe(true)
    expect(inspection.worksheets[0].headers).toEqual([])
  })

  it('malformed quoted CSV (unterminated quote) is MALFORMED_WORKBOOK', () => {
    const csv = 'a,b\n"unterminated,value\n'
    let error: unknown
    try {
      decodeWorksheet(toBytes(Buffer.from(csv)), { filename: 'bad.csv' }, { index: 0 })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).code).toBe('MALFORMED_WORKBOOK')
  })

  it('a negative worksheet index is WORKSHEET_NOT_FOUND, not a crash', () => {
    const buf = buildSpreadsheet([{ name: 'Only', rows: [['h'], [1]] }], 'xlsx')
    let error: unknown
    try {
      decodeWorksheet(toBytes(buf), { filename: 'book.xlsx' }, { index: -1 })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).code).toBe('WORKSHEET_NOT_FOUND')
  })

  it('a fractional worksheet index is WORKSHEET_NOT_FOUND, not a crash', () => {
    const buf = buildSpreadsheet([{ name: 'Only', rows: [['h'], [1]] }], 'xlsx')
    let error: unknown
    try {
      decodeWorksheet(toBytes(buf), { filename: 'book.xlsx' }, { index: 0.5 })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(WorkbookParserError)
    expect((error as WorkbookParserError).code).toBe('WORKSHEET_NOT_FOUND')
  })
})
