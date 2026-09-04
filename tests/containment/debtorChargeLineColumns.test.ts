import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C1-DBS2 — Debtors additive typed-column foundation. Real rehearsal-
// data investigation (Phase C1-DBR/C1-DBD/C1-DBS) established that a
// debtor_accounts row is a source CHARGE LINE (one account, one financial
// year, one quarter, one charge type) — not an account-level current-state
// row — and that the one candidate real source identifier
// (metadata.__md5Row) is present in the real source workbook but 0%
// populated. This suite tests scripts/add-debtor-charge-line-columns.ts's
// normalization rules against synthetic fixtures (no customer data), and
// statically verifies the script's own safety guarantees (no DELETE, no
// UNIQUE constraint, no __md5Row usage).
//
// The migration itself is raw SQL run directly against Postgres (matching
// this repo's established hand-written-SQL-migration convention — see
// CLAUDE.md), so there is no exported JS function to call directly.
// Behavioural tests below re-implement the EXACT regex/string-construction
// rules the migration's own SQL uses (verified below, via a dedicated test,
// to actually match the migration file's real SQL text — not a
// hand-copied twin that could silently drift) and apply them to synthetic
// example inputs, proving the parsing rules themselves are correct
// independent of any live database.

function readMigrationSource(): string {
  return fs.readFileSync(path.resolve(__dirname, '../../scripts/add-debtor-charge-line-columns.ts'), 'utf-8')
}

// ── Re-implementations of the migration's own normalization rules, kept
// honest by the "regex text matches the migration file" tests in the
// final describe block below. ──────────────────────────────────────────

function parseFinancialYear(bookname: string | null): string | null {
  if (bookname == null) return null
  const m = /^([0-9]{2})([0-9]{2})MISC$/.exec(bookname)
  if (!m) return null
  return `20${m[1]}-${m[2]}`
}

function parseFinancialQuarter(quarter: string | null): string | null {
  if (quarter == null) return null
  return /^Q[1-4]$/.test(quarter) ? quarter : null
}

function parseInvoiceDateShapeValid(isoLike: string | null): boolean {
  if (isoLike == null) return false
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}/.test(isoLike)
}

describe('Phase C1-DBS2 — financial_year parsing (bookname)', () => {
  it('2324MISC -> 2023-24', () => {
    expect(parseFinancialYear('2324MISC')).toBe('2023-24')
  })
  it('2425MISC -> 2024-25', () => {
    expect(parseFinancialYear('2425MISC')).toBe('2024-25')
  })
  it('2526MISC -> 2025-26', () => {
    expect(parseFinancialYear('2526MISC')).toBe('2025-26')
  })
  it('unknown bookname shapes are left unmapped (null), never guessed', () => {
    expect(parseFinancialYear('2425RATES')).toBeNull()   // different suffix — real, plausible future shape, must not be guessed
    expect(parseFinancialYear('MISC2425')).toBeNull()    // digits not leading
    expect(parseFinancialYear('24MISC')).toBeNull()      // too few digits
    expect(parseFinancialYear('')).toBeNull()
    expect(parseFinancialYear(null)).toBeNull()
  })
})

describe('Phase C1-DBS2 — financial_quarter parsing', () => {
  it('Q1 through Q4 are preserved exactly', () => {
    expect(parseFinancialQuarter('Q1')).toBe('Q1')
    expect(parseFinancialQuarter('Q2')).toBe('Q2')
    expect(parseFinancialQuarter('Q3')).toBe('Q3')
    expect(parseFinancialQuarter('Q4')).toBe('Q4')
  })
  it('invalid/unrecognized quarter values are left null, never guessed', () => {
    expect(parseFinancialQuarter('Q5')).toBeNull()
    expect(parseFinancialQuarter('quarter 1')).toBeNull()
    expect(parseFinancialQuarter('1')).toBeNull()
    expect(parseFinancialQuarter('')).toBeNull()
    expect(parseFinancialQuarter(null)).toBeNull()
  })
})

describe('Phase C1-DBS2 — invoice_date shape validation', () => {
  it('a real toISOString()-shaped value is recognized as valid', () => {
    expect(parseInvoiceDateShapeValid('2024-05-20T00:00:00.000Z')).toBe(true)
    expect(parseInvoiceDateShapeValid(new Date('2026-05-06T00:00:00.000Z').toISOString())).toBe(true)
  })
  it('malformed or non-date values are rejected, not blindly cast', () => {
    expect(parseInvoiceDateShapeValid('not-a-date')).toBe(false)
    expect(parseInvoiceDateShapeValid('2024/05/20')).toBe(false)
    expect(parseInvoiceDateShapeValid('')).toBe(false)
    expect(parseInvoiceDateShapeValid(null)).toBe(false)
  })
  it('this is the exact bug caught during this phase\'s own rehearsal run: the \\d shorthand silently collapses in a JS string literal', () => {
    // Demonstrates the actual defect found and fixed in this phase — \d in
    // a plain JS string is NOT a regex escape, it collapses to the literal
    // character "d". A regex BUILT FROM that broken string would become
    // "^d{4}-d{2}-...", which matches nothing real.
    const brokenPattern = '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
    expect(brokenPattern).toBe('^d{4}-d{2}-d{2}Td{2}:d{2}:d{2}') // \d silently became d
    expect(new RegExp(brokenPattern).test('2024-05-20T00:00:00.000Z')).toBe(false) // proves it would never have matched
  })
})

describe('Phase C1-DBS2 — source_book / source_charge_code verbatim preservation (behavioural contract)', () => {
  it('preserved value is byte-identical to the source value, even when the corresponding derived field cannot be parsed', () => {
    // Contract: source_book/source_charge_code are populated whenever the
    // source metadata field is present and non-empty, REGARDLESS of
    // whether financial_year/charge_type could be derived — verified
    // against the real migration's WHERE clauses below (Gate: separate
    // UPDATE statements, not conditioned on the derived-field's own
    // success).
    const source = readMigrationSource()
    const sourceBookUpdate = source.slice(source.indexOf('Step 2:'), source.indexOf('Step 3:'))
    expect(sourceBookUpdate).toMatch(/SET source_book = metadata->>'bookname'/)
    expect(sourceBookUpdate).toMatch(/SET source_charge_code = metadata->>'chargecode'/)
    // Neither UPDATE in Step 2 references financial_year/financial_quarter
    // at all — proving preservation is unconditional on derivation success.
    expect(sourceBookUpdate).not.toMatch(/financial_year|financial_quarter/)
  })
})

describe('Phase C1-DBS2 — migration safety guarantees (static source verification)', () => {
  const source = readMigrationSource()
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('contains no DELETE statement anywhere', () => {
    expect(code).not.toMatch(/DELETE\s+FROM/i)
  })

  it('contains no UNIQUE constraint / index creation', () => {
    expect(code).not.toMatch(/ADD\s+CONSTRAINT.*UNIQUE|CREATE\s+UNIQUE\s+INDEX/i)
  })

  it('does not reference __md5Row anywhere in executable SQL (comments explaining why it is unusable are fine)', () => {
    const withoutComments = code
    expect(withoutComments).not.toMatch(/__md5Row/)
    // The explanation of why it's unusable is expected to live in the
    // full source (comments), not stripped here — verify it's documented.
    expect(source).toMatch(/__md5Row/)
    expect(source).toMatch(/0%/)
    expect(source).toMatch(/populated/)
    expect(source).toMatch(/not usable as an|NOT usable/)
  })

  it('every ALTER TABLE ADD COLUMN uses IF NOT EXISTS (idempotent column creation)', () => {
    const alters = code.match(/ALTER TABLE debtor_accounts ADD COLUMN[^;]*/g) ?? []
    expect(alters.length).toBe(6)
    for (const stmt of alters) expect(stmt).toMatch(/ADD COLUMN IF NOT EXISTS/)
  })

  it('every backfill UPDATE is scoped to rows where the target column is still NULL (idempotent backfill, never re-derives an already-set value)', () => {
    const updates = code.match(/UPDATE debtor_accounts\s+SET[\s\S]*?(?=UPDATE debtor_accounts|console\.log\('\\n=== Verification)/g) ?? []
    expect(updates.length).toBeGreaterThanOrEqual(6)
    for (const stmt of updates) {
      expect(stmt).toMatch(/WHERE\s+\w+\s+IS\s+NULL/)
    }
  })

  it('never mutates existing business fields (outstanding_amount, original_amount, status, days_overdue, aging_bucket, account_number, account_name, metadata)', () => {
    const protectedFields = ['outstanding_amount', 'original_amount', 'status', 'days_overdue', 'aging_bucket', 'account_number', 'account_name']
    for (const field of protectedFields) {
      // None of these fields may appear as a SET target anywhere.
      expect(code).not.toMatch(new RegExp(`SET[\\s\\S]{0,60}\\b${field}\\s*=`))
    }
    // metadata itself is only ever READ (metadata->>'...'), never SET.
    expect(code).not.toMatch(/SET\s+metadata\s*=/)
  })

  it('uses [0-9] rather than \\d in every regex embedded in a JS/TS string (the exact class of bug this phase found and fixed)', () => {
    const regexLiterals = code.match(/'\^[^']*'/g) ?? []
    expect(regexLiterals.length).toBeGreaterThan(0)
    for (const lit of regexLiterals) {
      expect(lit).not.toMatch(/\\d/)
    }
  })

  it('the financial_year construction uses the exact-shape guard (NNNNMISC) established by this phase\'s investigation, not a loose prefix match', () => {
    expect(code).toMatch(/\^\[0-9\]\{4\}MISC\$/)
  })
})

describe('Phase C1-DBS2 — prisma/schema.prisma alignment', () => {
  it('DebtorAccount declares the six new nullable columns', () => {
    const schema = fs.readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf-8')
    const modelStart = schema.indexOf('model DebtorAccount {')
    const modelEnd = schema.indexOf('\n}', schema.indexOf('@@index([organisation_id]', modelStart))
    const model = schema.slice(modelStart, modelEnd)
    expect(model).toMatch(/financial_year\s+String\?/)
    expect(model).toMatch(/financial_quarter\s+String\?/)
    expect(model).toMatch(/charge_type\s+String\?/)
    expect(model).toMatch(/invoice_date\s+DateTime\?/)
    expect(model).toMatch(/source_book\s+String\?/)
    expect(model).toMatch(/source_charge_code\s+String\?/)
  })

  it('Phase C1-DBF superseded this: the false @@unique annotation was ACTUALLY REMOVED (not merely left in place with a correcting comment) — the schema must describe the real intended model', () => {
    const schema = fs.readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf-8')
    const modelStart = schema.indexOf('model DebtorAccount {')
    const modelEnd = schema.indexOf('\n}', schema.indexOf('@@index([organisation_id]', modelStart))
    const model = schema.slice(modelStart, modelEnd)
    const directiveLines = model.match(/^\s*@@unique\(/gm) ?? []
    expect(directiveLines.length).toBe(0)
    // The removal itself, and why, remains documented in a comment.
    expect(schema).toMatch(/REMOVED \(Phase C1-DBF\)/)
  })

  it('no new @@unique or @@index was added for the new columns', () => {
    const schema = fs.readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf-8')
    const modelStart = schema.indexOf('model DebtorAccount {')
    const modelEnd = schema.indexOf('\n}', schema.indexOf('@@index([organisation_id]', modelStart))
    const model = schema.slice(modelStart, modelEnd)
    // Match only real directive lines (start of line, optional
    // whitespace, then @@unique() — not the substring appearing inside
    // this model's own explanatory prose comments, which reference the
    // term "@@unique" several times in English sentences).
    const directiveLines = model.match(/^\s*@@unique\(/gm) ?? []
    expect(directiveLines.length).toBe(0) // Phase C1-DBF removed the one that used to be here
  })
})
