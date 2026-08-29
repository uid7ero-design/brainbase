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

  it('15. a generic ZIP renamed .xlsx is rejected, not silently accepted', () => {
    // Minimal valid ZIP local-file-header signature followed by bytes that
    // are not a real xlsx package (no [Content_Types].xml etc).
    const fakeZip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('not a real xlsx package'.repeat(4)),
    ])
    let error: unknown
    try {
      inspectWorkbook(toBytes(fakeZip), { filename: 'fake.xlsx' })
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
