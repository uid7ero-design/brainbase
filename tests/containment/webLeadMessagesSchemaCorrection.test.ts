import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const CANONICAL_MIGRATION = path.resolve(__dirname, '../../scripts/create-web-service-lead-messages.sql')
const CORRECTIVE_MIGRATION = path.resolve(__dirname, '../../scripts/fix-web-lead-messages-address-columns.sql')
const ROUTE_FILE = path.resolve(__dirname, '../../app/api/web-services/leads/[id]/messages/route.ts')
const UI_FILE = path.resolve(__dirname, '../../app/admin/web-services/LeadMessages.tsx')

function readFile(p: string): string {
  return fs.readFileSync(p, 'utf-8')
}

// Extracts the column names declared inside CREATE TABLE web_lead_messages (...)
// from the canonical migration file.
function canonicalColumns(): string[] {
  const source = readFile(CANONICAL_MIGRATION)
  const match = source.match(/CREATE TABLE IF NOT EXISTS web_lead_messages \(([\s\S]*?)\n\);/)
  expect(match).not.toBeNull()
  return match![1]
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.split(/\s+/)[0])
}

describe('scripts/create-web-service-lead-messages.sql — canonical schema is untouched and correct', () => {
  it('declares from_address and to_address as NOT NULL columns', () => {
    const source = readFile(CANONICAL_MIGRATION)
    expect(source).toMatch(/from_address\s+TEXT\s+NOT NULL/)
    expect(source).toMatch(/to_address\s+TEXT\s+NOT NULL/)
  })

  it('never declares a recipient_email column — that was never the intended schema', () => {
    const source = readFile(CANONICAL_MIGRATION)
    expect(source).not.toContain('recipient_email')
  })

  it('still creates the table as CREATE TABLE IF NOT EXISTS (this file was not rewritten into an ALTER-based correction)', () => {
    const source = readFile(CANONICAL_MIGRATION)
    expect(source).toContain('CREATE TABLE IF NOT EXISTS web_lead_messages')
  })
})

describe('scripts/fix-web-lead-messages-address-columns.sql — the corrective migration', () => {
  const source = readFile(CORRECTIVE_MIGRATION)

  it('adds from_address and to_address as NOT NULL columns, idempotently', () => {
    expect(source).toMatch(/ALTER TABLE web_lead_messages ADD COLUMN IF NOT EXISTS from_address\s+TEXT NOT NULL/)
    expect(source).toMatch(/ALTER TABLE web_lead_messages ADD COLUMN IF NOT EXISTS to_address\s+TEXT NOT NULL/)
  })

  it('drops recipient_email idempotently', () => {
    expect(source).toMatch(/ALTER TABLE web_lead_messages DROP COLUMN IF EXISTS recipient_email/)
  })

  it('is a corrective ALTER script, not a second CREATE TABLE (does not recreate/drop the whole table)', () => {
    expect(source).not.toMatch(/CREATE TABLE/)
    expect(source).not.toMatch(/DROP TABLE\s+web_lead_messages\s*;/) // the commented-out rollback note doesn't count as an executable statement
  })

  it('never touches the primary key, either foreign key, the direction CHECK, or the index', () => {
    // Scoped to actual executable SQL, not a blanket string ban — the
    // file's own explanatory comments legitimately name these constructs
    // when documenting that they're intentionally left alone. Strip
    // comment lines before asserting.
    const executable = source
      .split('\n')
      .filter(l => !l.trim().startsWith('--'))
      .join('\n')
    expect(executable).not.toMatch(/DROP CONSTRAINT/)
    expect(executable).not.toMatch(/DROP INDEX/)
    expect(executable).not.toContain('PRIMARY KEY')
    expect(executable).not.toContain('REFERENCES')
    expect(executable).not.toContain('CHECK')
    expect(executable).not.toContain('idx_web_lead_messages_lead')
  })

  it('only ever operates on from_address, to_address, and recipient_email — no other column is touched', () => {
    const alterLines = source.split('\n').filter(l => l.trim().startsWith('ALTER TABLE'))
    expect(alterLines.length).toBeGreaterThan(0)
    for (const line of alterLines) {
      expect(line).toMatch(/from_address|to_address|recipient_email/)
    }
  })
})

describe('Contract agreement — the deployed route\'s INSERT/SELECT match the canonical schema', () => {
  const columns = canonicalColumns()

  it('canonical schema includes from_address and to_address, excludes recipient_email', () => {
    expect(columns).toContain('from_address')
    expect(columns).toContain('to_address')
    expect(columns).not.toContain('recipient_email')
  })

  it('the route\'s INSERT column list only references columns that exist in the canonical schema', () => {
    const source = readFile(ROUTE_FILE)
    const insertMatch = source.match(/INSERT INTO web_lead_messages \(([\s\S]*?)\)\s*VALUES/)
    expect(insertMatch).not.toBeNull()
    const insertColumns = insertMatch![1].split(',').map(c => c.trim()).filter(Boolean)
    expect(insertColumns).toContain('from_address')
    expect(insertColumns).toContain('to_address')
    expect(insertColumns).not.toContain('recipient_email')
    for (const col of insertColumns) {
      expect(columns).toContain(col)
    }
  })

  it('the route\'s GET SELECT only references columns that exist in the canonical schema', () => {
    const source = readFile(ROUTE_FILE)
    expect(source).toMatch(/m\.from_address, m\.to_address/)
    expect(source).not.toContain('recipient_email')
  })

  it('the route\'s RETURNING clause only references columns that exist in the canonical schema', () => {
    const source = readFile(ROUTE_FILE)
    const returningMatch = source.match(/RETURNING ([^\n`]+)/)
    expect(returningMatch).not.toBeNull()
    const returningColumns = returningMatch![1].split(',').map(c => c.trim())
    expect(returningColumns).toContain('from_address')
    expect(returningColumns).toContain('to_address')
    for (const col of returningColumns) {
      expect(columns).toContain(col)
    }
  })

  it('recipient_email is not part of the intended final schema anywhere in the application contract', () => {
    const route = readFile(ROUTE_FILE)
    const ui = readFile(UI_FILE)
    expect(route).not.toContain('recipient_email')
    expect(ui).not.toContain('recipient_email')
  })
})

describe('Scope boundaries — this branch only touches the approved files', () => {
  it('app/api/web-services/leads/[id]/messages/route.ts is unchanged (the code was already correct — only Production\'s schema needed correction)', () => {
    // The route already used from_address/to_address before this branch;
    // this is a sanity check that no application-code rewrite was needed
    // or performed to "match" recipient_email.
    const source = readFile(ROUTE_FILE)
    expect(source).toContain('from_address, to_address, resend_message_id, created_by')
  })

  it('LD Tennis\'s tennis_lead_messages migration is untouched', () => {
    const source = readFile(path.resolve(__dirname, '../../scripts/create-tennis-lead-messages.sql'))
    expect(source).toContain('from_address')
    expect(source).toContain('to_address')
  })
})
