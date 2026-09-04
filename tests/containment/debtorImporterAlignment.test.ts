import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C1-DBI — Debtors importer typed-column alignment + legacy ingest
// safety. debtor_account_summary and the corrected KPI route (Phase
// C1-DBR2) depend on the six typed/source-preservation columns
// (financial_year/financial_quarter/charge_type/invoice_date/source_book/
// source_charge_code) being populated correctly — this suite proves both
// ingestion paths (the generic in-app importer and the legacy bootstrap
// script) now populate them at write time via one shared normalization
// helper, and that the legacy script can no longer silently destroy an
// organisation's real debtor data. Synthetic fixtures only.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// ── §2/§10 items 3-10 — shared normalization helper, pure unit tests ────

import {
  normalizeFinancialYear,
  normalizeFinancialQuarter,
  normalizeChargeCode,
  normalizeSourceBook,
  normalizeInvoiceDate,
  normalizeDebtorSourceFields,
  tallyNormalizationFailure,
  emptyNormalizationCounts,
} from '@/modules/debtors/normalize'

describe('Phase C1-DBI — normalizeFinancialYear (item 3: known shapes, item 4: unknown -> null)', () => {
  it('maps the exact NNNNMISC bookname shape to YYYY-YY, matching the approved backfill migration exactly', () => {
    expect(normalizeFinancialYear('2324MISC')).toBe('2023-24')
    expect(normalizeFinancialYear('2425MISC')).toBe('2024-25')
    expect(normalizeFinancialYear('2526MISC')).toBe('2025-26')
  })
  it('never guesses an unrecognized bookname shape — returns null, not an approximation', () => {
    expect(normalizeFinancialYear('MISC2324')).toBeNull()
    expect(normalizeFinancialYear('2324-MISC')).toBeNull()
    expect(normalizeFinancialYear('random')).toBeNull()
    expect(normalizeFinancialYear('')).toBeNull()
    expect(normalizeFinancialYear(null)).toBeNull()
    expect(normalizeFinancialYear(undefined)).toBeNull()
  })
})

describe('Phase C1-DBI — normalizeFinancialQuarter (item 5: Q1-Q4, item 6: invalid -> null)', () => {
  it('preserves an exact Q1-Q4 value unchanged', () => {
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
      expect(normalizeFinancialQuarter(q)).toBe(q)
    }
  })
  it('rejects anything outside the exact Q1-Q4 shape', () => {
    expect(normalizeFinancialQuarter('Q5')).toBeNull()
    expect(normalizeFinancialQuarter('q1')).toBeNull()
    expect(normalizeFinancialQuarter('1')).toBeNull()
    expect(normalizeFinancialQuarter('Quarter 1')).toBeNull()
    expect(normalizeFinancialQuarter('')).toBeNull()
    expect(normalizeFinancialQuarter(null)).toBeNull()
  })
})

describe('Phase C1-DBI — invoice_date parsing (item 7: valid, item 8: invalid)', () => {
  it('parses a strict ISO-8601 date/datetime string', () => {
    expect(normalizeInvoiceDate('2024-03-15')?.toISOString().slice(0, 10)).toBe('2024-03-15')
    expect(normalizeInvoiceDate('2024-03-15T00:00:00.000Z')?.toISOString()).toBe('2024-03-15T00:00:00.000Z')
  })
  it('accepts an already-parsed Date (xlsx cellDates:true output) unchanged', () => {
    const d = new Date('2024-06-01T00:00:00.000Z')
    expect(normalizeInvoiceDate(d)).toBe(d)
  })
  it('never guesses an ambiguous or invalid shape — returns null', () => {
    expect(normalizeInvoiceDate('15/03/2024')).toBeNull()
    expect(normalizeInvoiceDate('not a date')).toBeNull()
    expect(normalizeInvoiceDate('')).toBeNull()
    expect(normalizeInvoiceDate(null)).toBeNull()
    expect(normalizeInvoiceDate(undefined)).toBeNull()
    expect(normalizeInvoiceDate(45123)).toBeNull() // bare Excel serial — never interpreted, would be guessing
    expect(normalizeInvoiceDate(new Date('not a date'))).toBeNull() // an invalid Date instance
  })
})

describe('Phase C1-DBI — source_book / source_charge_code verbatim preservation (items 9-10)', () => {
  it('preserves the exact source string (trimmed only, never altered/normalized)', () => {
    expect(normalizeSourceBook('  2324MISC  ')).toBe('2324MISC')
    expect(normalizeSourceBook('Some Weird Bookname!!')).toBe('Some Weird Bookname!!')
    expect(normalizeChargeCode('  MISC01  ')).toBe('MISC01')
    expect(normalizeChargeCode('anything-goes-here')).toBe('anything-goes-here')
  })
  it('blank/whitespace-only source values become null, not an empty string', () => {
    expect(normalizeSourceBook('   ')).toBeNull()
    expect(normalizeChargeCode('')).toBeNull()
  })
  it('charge_type is the identical value to source_charge_code (both derived from the same raw field, matching the backfill migration steps 2-3)', () => {
    const fields = normalizeDebtorSourceFields({ source_charge_code: ' MISC01 ' })
    expect(fields.charge_type).toBe(fields.source_charge_code)
    expect(fields.charge_type).toBe('MISC01')
  })
  it('does not use metadata.__md5Row anywhere in this module', () => {
    expect(readSource('modules/debtors/normalize.ts')).not.toMatch(/__md5Row/)
  })
})

describe('Phase C1-DBI — normalizeDebtorSourceFields / tallyNormalizationFailure', () => {
  it('a fully well-formed row produces all six typed fields populated (rollup-compatible, item 15)', () => {
    const fields = normalizeDebtorSourceFields({
      source_book: '2324MISC',
      source_charge_code: 'MISC01',
      financial_quarter: 'Q2',
      invoice_date: '2023-10-15T00:00:00.000Z',
    })
    expect(fields.financial_year).toBe('2023-24')
    expect(fields.financial_quarter).toBe('Q2')
    expect(fields.charge_type).toBe('MISC01')
    expect(fields.source_book).toBe('2324MISC')
    expect(fields.source_charge_code).toBe('MISC01')
    expect(fields.invoice_date).toBeInstanceOf(Date)
    expect(fields.invoice_date?.toISOString()).toBe('2023-10-15T00:00:00.000Z')
  })
  it('tally only counts a field as a failure when the raw source value was non-blank but did not normalize (never counts a genuinely blank source as an error)', () => {
    const counts = emptyNormalizationCounts()
    const raw = { source_book: 'not-a-recognized-shape', source_charge_code: '', financial_quarter: 'Q9', invoice_date: 'garbage' }
    const fields = normalizeDebtorSourceFields(raw)
    tallyNormalizationFailure(counts, raw, fields)
    expect(counts.unrecognized_bookname).toBe(1)
    expect(counts.invalid_quarter).toBe(1)
    expect(counts.unparseable_invoice_date).toBe(1)
    expect(counts.blank_chargecode).toBe(1)

    const counts2 = emptyNormalizationCounts()
    const raw2 = { source_book: '', financial_quarter: '', invoice_date: '' }
    const fields2 = normalizeDebtorSourceFields(raw2)
    tallyNormalizationFailure(counts2, raw2, fields2)
    expect(counts2.unrecognized_bookname).toBe(0) // blank source, not a recognition failure
    expect(counts2.invalid_quarter).toBe(0)
    expect(counts2.unparseable_invoice_date).toBe(0)
  })
})

// ── §3/§10 items 1-2, 11-14 — generic importer behavioural tests ────────

const uploadFindUniqueMock = vi.fn()
const uploadFindFirstMock = vi.fn()
const createManyMock = vi.fn()
const parseFileMock = vi.fn()
const persistMetricsMock = vi.fn()

// modules/debtors/index.ts reads `stored_path` via fs.readFileSync before
// handing the buffer to parseFile (mocked below to ignore its content) —
// point every test at a real, always-present repo file rather than
// mocking `fs` globally, which would also break readSource()'s own real
// file reads used throughout this suite's static containment checks.
const REAL_STORED_PATH = path.resolve(__dirname, '../../package.json')

vi.mock('@/services/upload', () => ({
  parseFile: (...args: unknown[]) => parseFileMock(...args),
}))
vi.mock('@/services/persistence', () => ({
  persistMetrics: (...args: unknown[]) => persistMetricsMock(...args),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    upload: {
      findUnique: (...args: unknown[]) => uploadFindUniqueMock(...args),
      findFirst:  (...args: unknown[]) => uploadFindFirstMock(...args),
    },
    debtorAccount: {
      createMany: (...args: unknown[]) => createManyMock(...args),
    },
  },
}))

const FIELD_MAPPINGS: Record<string, string | null> = {
  account_number: 'ACCOUNT',
  account_name: 'ACCOUNTNAME',
  outstanding_amount: 'OUTSTANDING',
  original_amount: null,
  days_overdue: null,
  aging_bucket: null,
  last_payment_date: null,
  last_payment_amount: null,
  status: null,
  collection_stage: null,
  source_book: 'BOOKNAME',
  source_charge_code: 'CHARGECODE',
  financial_quarter: 'QUARTER',
  invoice_date: 'INVOICEDATE',
}

beforeEach(() => {
  uploadFindUniqueMock.mockReset().mockResolvedValue({ id: 'up-1', original_name: 'debtors.csv' })
  uploadFindFirstMock.mockReset().mockResolvedValue(null) // no prior upload by default
  createManyMock.mockReset().mockResolvedValue({ count: 0 })
  persistMetricsMock.mockReset().mockResolvedValue(undefined)
  parseFileMock.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('Phase C1-DBI — generic importer populates the six typed fields at write time (items 1, 15)', () => {
  it('createMany receives fully-populated typed columns for a well-formed row', async () => {
    parseFileMock.mockReturnValue({
      rows: [{ ACCOUNT: 'A1', ACCOUNTNAME: 'Alice', OUTSTANDING: '100', BOOKNAME: '2324MISC', CHARGECODE: 'MISC01', QUARTER: 'Q2', INVOICEDATE: '2023-10-15T00:00:00.000Z' }],
    })
    const { importDebtors } = await import('@/modules/debtors')
    await importDebtors('up-1', 'org-a', REAL_STORED_PATH, FIELD_MAPPINGS)

    expect(createManyMock).toHaveBeenCalledTimes(1)
    const records = createManyMock.mock.calls[0][0].data as Array<Record<string, unknown>>
    expect(records).toHaveLength(1)
    const r = records[0]
    expect(r.financial_year).toBe('2023-24')
    expect(r.financial_quarter).toBe('Q2')
    expect(r.charge_type).toBe('MISC01')
    expect(r.source_book).toBe('2324MISC')
    expect(r.source_charge_code).toBe('MISC01')
    expect(r.invoice_date).toBeInstanceOf(Date)
    expect((r.invoice_date as Date).toISOString()).toBe('2023-10-15T00:00:00.000Z')
  })
})

describe('Phase C1-DBI — raw metadata is preserved as the permanent lineage record (item 2)', () => {
  it('metadata carries the raw bookname/chargecode/quarter/invoice_date strings under the same keys the backfill migration reads from', async () => {
    parseFileMock.mockReturnValue({
      rows: [{ ACCOUNT: 'A1', ACCOUNTNAME: 'Alice', OUTSTANDING: '100', BOOKNAME: '2324MISC', CHARGECODE: 'MISC01', QUARTER: 'Q2', INVOICEDATE: '2023-10-15T00:00:00.000Z' }],
    })
    const { importDebtors } = await import('@/modules/debtors')
    await importDebtors('up-1', 'org-a', REAL_STORED_PATH, FIELD_MAPPINGS)
    const r = createManyMock.mock.calls[0][0].data[0] as Record<string, Record<string, unknown>>
    expect(r.metadata.bookname).toBe('2324MISC')
    expect(r.metadata.chargecode).toBe('MISC01')
    expect(r.metadata.quarter).toBe('Q2')
    expect(r.metadata.invoice_date).toBe('2023-10-15T00:00:00.000Z')
  })

  it('an unrecognized source shape still preserves the verbatim raw value in metadata even though the derived typed column is left null (no source information ever lost)', async () => {
    parseFileMock.mockReturnValue({
      rows: [{ ACCOUNT: 'A1', ACCOUNTNAME: 'Alice', OUTSTANDING: '100', BOOKNAME: 'WeirdBookName', CHARGECODE: 'X1', QUARTER: 'Q9', INVOICEDATE: 'not-a-date' }],
    })
    const { importDebtors } = await import('@/modules/debtors')
    await importDebtors('up-1', 'org-a', REAL_STORED_PATH, FIELD_MAPPINGS)
    const r = createManyMock.mock.calls[0][0].data[0] as Record<string, unknown>
    expect(r.financial_year).toBeNull()
    expect(r.financial_quarter).toBeNull()
    const metadata = r.metadata as Record<string, unknown>
    expect(metadata.bookname).toBe('WeirdBookName')
    expect(metadata.quarter).toBe('Q9')
  })
})

describe('Phase C1-DBI — repeated account_number never overwrites (items 11-12)', () => {
  it('two charge lines for the same account_number both survive as two separate rows', async () => {
    parseFileMock.mockReturnValue({
      rows: [
        { ACCOUNT: 'A1', ACCOUNTNAME: 'Alice', OUTSTANDING: '100', BOOKNAME: '2324MISC', CHARGECODE: 'MISC01', QUARTER: 'Q1', INVOICEDATE: '2023-08-01T00:00:00.000Z' },
        { ACCOUNT: 'A1', ACCOUNTNAME: 'Alice', OUTSTANDING: '50',  BOOKNAME: '2425MISC', CHARGECODE: 'MISC02', QUARTER: 'Q3', INVOICEDATE: '2024-11-01T00:00:00.000Z' },
      ],
    })
    const { importDebtors } = await import('@/modules/debtors')
    const count = await importDebtors('up-1', 'org-a', REAL_STORED_PATH, FIELD_MAPPINGS)
    expect(count).toBe(2)
    const records = createManyMock.mock.calls[0][0].data as Array<Record<string, unknown>>
    expect(records).toHaveLength(2)
    expect(records.every(r => r.account_number === 'A1')).toBe(true)
    expect(records[0].financial_year).toBe('2023-24')
    expect(records[1].financial_year).toBe('2024-25')
  })
})

describe('Phase C1-DBI — duplicate-import-risk metadata merges rather than discards (item 13)', () => {
  it('a detected repeat import still inserts every row, with the risk marker MERGED into (not replacing) the real source lineage metadata', async () => {
    uploadFindFirstMock.mockResolvedValue({ id: 'up-0', original_name: 'debtors.csv' }) // a prior COMPLETE upload with the same name
    parseFileMock.mockReturnValue({
      rows: [{ ACCOUNT: 'A1', ACCOUNTNAME: 'Alice', OUTSTANDING: '100', BOOKNAME: '2324MISC', CHARGECODE: 'MISC01', QUARTER: 'Q1', INVOICEDATE: '2023-08-01T00:00:00.000Z' }],
    })
    const { importDebtors } = await import('@/modules/debtors')
    const count = await importDebtors('up-1', 'org-a', REAL_STORED_PATH, FIELD_MAPPINGS)
    expect(count).toBe(1) // row is NOT discarded
    const r = createManyMock.mock.calls[0][0].data[0] as Record<string, unknown>
    const metadata = r.metadata as Record<string, unknown>
    expect(metadata.duplicate_import_risk).toBe(true)
    expect(metadata.prior_upload_id).toBe('up-0')
    // Original lineage fields are still present, not discarded by the merge:
    expect(metadata.bookname).toBe('2324MISC')
    expect(metadata.chargecode).toBe('MISC01')
  })
})

describe('Phase C1-DBI — normalization warnings never expose PII (item 14)', () => {
  it('the aggregate normalization warning contains only counts, never an account number/name/amount', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    parseFileMock.mockReturnValue({
      rows: [
        { ACCOUNT: 'SECRET-ACCT-42', ACCOUNTNAME: 'Sensitive Ratepayer Name', OUTSTANDING: '999999', BOOKNAME: 'GARBAGE', CHARGECODE: '', QUARTER: 'Q9', INVOICEDATE: 'not-a-date' },
      ],
    })
    const { importDebtors } = await import('@/modules/debtors')
    await importDebtors('up-1', 'org-a', REAL_STORED_PATH, FIELD_MAPPINGS)

    const normalizationWarning = warnSpy.mock.calls.map(c => String(c[0])).find(m => m.includes('normalization summary'))
    expect(normalizationWarning).toBeDefined()
    expect(normalizationWarning).not.toContain('SECRET-ACCT-42')
    expect(normalizationWarning).not.toContain('Sensitive Ratepayer Name')
    expect(normalizationWarning).not.toContain('999999')
    expect(normalizationWarning).toMatch(/unrecognized bookname: 1/)
    expect(normalizationWarning).toMatch(/blank chargecode: 1/)
    warnSpy.mockRestore()
  })
})

describe('Phase C1-DBI — organisation scoping (item 20)', () => {
  it('every record created by importDebtors carries the caller-supplied organisation_id', async () => {
    parseFileMock.mockReturnValue({
      rows: [{ ACCOUNT: 'A1', ACCOUNTNAME: 'Alice', OUTSTANDING: '100' }],
    })
    const { importDebtors } = await import('@/modules/debtors')
    await importDebtors('up-1', 'org-scoped-xyz', REAL_STORED_PATH, FIELD_MAPPINGS)
    const records = createManyMock.mock.calls[0][0].data as Array<Record<string, unknown>>
    expect(records.every(r => r.organisation_id === 'org-scoped-xyz')).toBe(true)
  })
})

// ── §3 canonical field wiring — lib/column-mapper.ts static containment ─

describe('Phase C1-DBI — lib/column-mapper.ts exposes the four new raw canonical fields for DEBTORS', () => {
  const source = readSource('lib/column-mapper.ts')

  it('SCHEMA_FIELDS.DEBTORS includes source_book, source_charge_code, financial_quarter, invoice_date', () => {
    const start = source.indexOf('DEBTORS:')
    const line = source.slice(start, source.indexOf('\n', start))
    for (const field of ['source_book', 'source_charge_code', 'financial_quarter', 'invoice_date']) {
      expect(line, `missing ${field}`).toContain(`"${field}"`)
    }
  })

  it('each new canonical field has a real alias list (not just its own literal name)', () => {
    expect(source).toMatch(/source_book:\s*\["bookname"/)
    expect(source).toMatch(/source_charge_code:\s*\["chargecode"/)
    expect(source).toMatch(/financial_quarter:\s*\["invoicequarter"/)
    expect(source).toMatch(/invoice_date:\s*\["invoicedate"/)
  })
})

// ── §4/§5/§10 items 16-19 — legacy ingest-from-folders.ts safety ────────

describe('Phase C1-DBI — ingest-from-folders.ts cannot silently destroy an organisation\'s real debtor data (items 16-17)', () => {
  const source = readSource('scripts/ingest-from-folders.ts')
  const code = stripComments(source)

  it('reads an explicit destructive-override flag that fails closed unless the value is exactly "true"', () => {
    expect(code).toMatch(/ALLOW_DEBTORS_REPLACE\s*=\s*process\.env\.ALLOW_DEBTORS_REPLACE\s*===\s*'true'/)
  })

  it('ingestDebtors() checks existing rows and the override flag BEFORE its destructive deleteMany, with a return path that skips deleteMany entirely', () => {
    const fnStart = code.indexOf('async function ingestDebtors')
    // The real deleteMany CALL, not the console.error prose that also
    // mentions the word "deleteMany" while explaining the refusal.
    const deleteIdx = code.indexOf('prisma.debtorAccount.deleteMany(', fnStart)
    const guardRegion = code.slice(fnStart, deleteIdx)
    expect(guardRegion).toMatch(/existingCount/)
    expect(guardRegion).toMatch(/ALLOW_DEBTORS_REPLACE/)
    expect(guardRegion).toMatch(/\breturn;/)
  })

  it('the preflight count and the guard are both scoped to this organisation (ORG_ID), never a global count', () => {
    const fnStart = code.indexOf('async function ingestDebtors')
    const deleteIdx = code.indexOf('prisma.debtorAccount.deleteMany(', fnStart)
    const guardRegion = code.slice(fnStart, deleteIdx)
    const countCalls = guardRegion.match(/prisma\.debtorAccount\.count\(\{[^}]*\}/g) ?? []
    expect(countCalls.length).toBeGreaterThanOrEqual(2) // existingCount + lineageBackedCount
    for (const call of countCalls) expect(call).toMatch(/organisation_id:\s*ORG_ID/)
  })

  it('the lineage-backed preflight count specifically checks upload_id IS NOT NULL (the only signal distinguishing real imported rows from this script\'s own prior runs)', () => {
    expect(code).toMatch(/upload_id:\s*\{\s*not:\s*null\s*\}/)
  })

  it('an empty-organisation (bootstrap) run is never blocked by the guard — existingCount === 0 takes the non-refusing branch unconditionally', () => {
    // Static proof the guard condition is `existingCount > 0 && !ALLOW_DEBTORS_REPLACE`,
    // not merely `!ALLOW_DEBTORS_REPLACE` — a brand-new org must never need the flag.
    expect(code).toMatch(/existingCount\s*>\s*0\s*&&\s*!ALLOW_DEBTORS_REPLACE/)
  })
})

describe('Phase C1-DBI — legacy script typed-column population reuses the shared helper, never duplicates the rules (item 5 dedup)', () => {
  const source = readSource('scripts/ingest-from-folders.ts')

  it('imports normalizeDebtorSourceFields from the shared module rather than reimplementing bookname/quarter/date regexes', () => {
    expect(source).toMatch(/import\s*\{[^}]*normalizeDebtorSourceFields[^}]*\}\s*from\s*['"]\.\.\/modules\/debtors\/normalize['"]/)
    // No independent MISC-pattern or Q1-Q4 regex reimplemented locally in this file.
    expect(source).not.toMatch(/MISC\$/)
    expect(source).not.toMatch(/Q\[1-4\]/)
  })

  it('every inserted debtor row includes all six typed columns', () => {
    const fnStart = source.indexOf('async function ingestDebtors')
    const returnBlock = source.slice(source.indexOf('return {', fnStart), source.indexOf('};', source.indexOf('return {', fnStart)))
    for (const field of ['financial_year', 'financial_quarter', 'charge_type', 'invoice_date', 'source_book', 'source_charge_code']) {
      expect(returnBlock, `missing ${field}`).toMatch(new RegExp(field))
    }
  })
})

describe('Phase C1-DBI — no unique constraint, no row-level dedup introduced anywhere this phase (items 18-19)', () => {
  it('prisma/schema.prisma DebtorAccount still has no @@unique directive', () => {
    const schema = readSource('prisma/schema.prisma')
    const modelStart = schema.indexOf('model DebtorAccount {')
    const modelEnd = schema.indexOf('\n}', schema.indexOf('@@index([organisation_id]', modelStart))
    const model = schema.slice(modelStart, modelEnd)
    expect(model.match(/^\s*@@unique\(/gm) ?? []).toHaveLength(0)
  })

  it('none of the three touched files access metadata.__md5Row as a value (prose/comments may mention its history — see checkRepeatedImportRisk\'s own warning text — but no code ever reads it as a property)', () => {
    // A property-access pattern (`.__md5Row`, `['__md5Row']`) would mean the
    // field is being READ for identity/dedup purposes; plain prose
    // referencing the name (e.g. explaining why it can't be used) does not
    // match this, since it's never immediately preceded by `.` or `[`.
    const propertyAccess = /[.[]\s*['"]?__md5Row/
    expect(stripComments(readSource('modules/debtors/normalize.ts'))).not.toMatch(propertyAccess)
    expect(stripComments(readSource('modules/debtors/index.ts'))).not.toMatch(propertyAccess)
    expect(stripComments(readSource('scripts/ingest-from-folders.ts'))).not.toMatch(propertyAccess)
  })

  it('the generic importer performs no row-level dedup — skipDuplicates is never reintroduced, and createMany has no where-keyed matching', () => {
    const code = stripComments(readSource('modules/debtors/index.ts'))
    expect(code).not.toMatch(/skipDuplicates/)
    expect(code).not.toMatch(/\.upsert\(/)
  })
})
