import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C2 — scripts/seed-commercial-capabilities.sql registers the
// future Commercial Suite capability keys, matching
// scripts/seed-debtors-capability.sql's (Phase C1.1) exact, already-
// proven-safe shape: registry seed only, ON CONFLICT DO NOTHING,
// zero organisation_modules writes.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

const source = readSource('scripts/seed-commercial-capabilities.sql')
const code = stripComments(source)

describe('Phase C2 — commercial capability registry seed', () => {
  const expectedKeys = ['sales', 'quotes', 'invoicing', 'purchasing', 'expenses', 'budgeting', 'finance_intelligence']

  it.each(expectedKeys)("registers key '%s'", (key) => {
    expect(source).toMatch(new RegExp(`'${key}'`))
  })

  it('registers exactly seven keys — no extra, no missing', () => {
    const matches = source.match(/^\s*\('([a-z_]+)',/gm) ?? []
    expect(matches.length).toBe(7)
  })

  it('is idempotent via ON CONFLICT (key) DO NOTHING', () => {
    expect(source).toMatch(/ON CONFLICT \(key\) DO NOTHING/)
  })

  it('never writes to organisation_modules — grants nothing to any organisation', () => {
    expect(source).not.toMatch(/INSERT INTO organisation_modules/i)
    expect(source).not.toMatch(/UPDATE organisation_modules/i)
  })

  it('contains exactly one INSERT statement, into modules only', () => {
    const inserts = source.match(/INSERT INTO \w+/g) ?? []
    expect(inserts).toEqual(['INSERT INTO modules'])
  })

  it('every seeded key is active = true (the platform-wide switch) — per-organisation entitlement remains a separate, later decision', () => {
    const valuesIdx = code.indexOf('VALUES')
    const valuesBlock = code.slice(valuesIdx, code.indexOf('ON CONFLICT', valuesIdx))
    const rows = valuesBlock.match(/\([^()]*\)/g) ?? []
    expect(rows.length).toBe(7)
    for (const row of rows) expect(row, row).toMatch(/,\s*true\)/)
  })

  it('no destructive statement anywhere (no DROP, DELETE, TRUNCATE, UPDATE)', () => {
    expect(code).not.toMatch(/DROP|DELETE|TRUNCATE/i)
  })
})
