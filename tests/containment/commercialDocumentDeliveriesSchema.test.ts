import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C3-POLISH-R §8 — static containment on
// scripts/create-commercial-document-deliveries.sql, matching the
// established convention from tests/containment/commercialQuotesSchema.test.ts.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

const source = stripComments(readSource('scripts/create-commercial-document-deliveries.sql'))
const start = source.indexOf('CREATE TABLE IF NOT EXISTS commercial_document_deliveries (')
const body = source.slice(start, source.indexOf(');', start))

describe('Phase C3-POLISH-R — commercial_document_deliveries schema is idempotent and non-destructive', () => {
  it('every table/index creation uses IF NOT EXISTS', () => {
    const ddlLines = source.split('\n').filter(l => /CREATE (TABLE|INDEX|UNIQUE INDEX)/.test(l))
    expect(ddlLines.length).toBeGreaterThan(1)
    for (const line of ddlLines) expect(line, line).toMatch(/IF NOT EXISTS/)
  })

  it('contains no destructive DDL/DML (no DROP, DELETE, TRUNCATE)', () => {
    expect(source).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i)
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(source).not.toMatch(/TRUNCATE/i)
  })

  it('never INSERTs a row for any existing organisation — schema only', () => {
    expect(source).not.toMatch(/INSERT INTO commercial_/i)
  })
})

describe('Phase C3-POLISH-R — tenant scoping and composite FK', () => {
  it('is tenant-scoped by organisation_id TEXT NOT NULL REFERENCES organisations(id)', () => {
    expect(body).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/)
  })

  it('document_id is a COMPOSITE FK onto commercial_quotes(id, organisation_id) — never a plain single-column FK', () => {
    expect(body).toMatch(/FOREIGN KEY \(document_id, organisation_id\)\s*\n\s*REFERENCES commercial_quotes \(id, organisation_id\)/)
    expect(body).not.toMatch(/document_id\s+UUID NOT NULL REFERENCES commercial_quotes\(id\)/)
  })
})

describe('Phase C3-POLISH-R — channel and status model support future SMS/webhook confirmation without a schema change', () => {
  it('channel CHECK constraint accepts both EMAIL and SMS', () => {
    expect(body).toMatch(/channel\s+TEXT NOT NULL CHECK \(channel IN \('EMAIL', 'SMS'\)\)/)
  })

  it('status CHECK constraint accepts DELIVERED for forward-compatibility, even though no code path writes it yet', () => {
    expect(body).toMatch(/status\s+TEXT NOT NULL CHECK \(status IN \('PENDING', 'SENT', 'DELIVERED', 'FAILED'\)\)/)
  })

  it('document_type is currently restricted to quote only, matching the composite FK above', () => {
    expect(body).toMatch(/document_type\s+TEXT NOT NULL CHECK \(document_type IN \('quote'\)\)/)
  })
})
