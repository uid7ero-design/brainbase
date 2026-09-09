import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C4.3B — static containment on
// scripts/widen-commercial-document-deliveries-for-invoices.sql,
// matching the established convention from
// tests/containment/commercialQuotesSchema.test.ts (C3), adapted for
// this migration's own genuinely different shape: unlike C3's purely
// additive migration, this one legitimately DROPS two constraints (a
// stale CHECK and the quote-only composite FK) — so the destructive-DDL
// guard below is intentionally narrower than a blanket "no DROP at
// all," matching exactly what this migration is authorized to do.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

const source = stripComments(readSource('scripts/widen-commercial-document-deliveries-for-invoices.sql'))

describe('Phase C4.3B — the widening migration drops exactly two named constraints, nothing else destructive', () => {
  it('drops the quote-only composite FK by its exact known name, guarded by IF EXISTS', () => {
    expect(source).toMatch(/DROP CONSTRAINT IF EXISTS commercial_document_deliveries_quote_org_fkey/)
  })

  it('drops the old document_type CHECK by its exact Postgres-default name, guarded by IF EXISTS', () => {
    expect(source).toMatch(/DROP CONSTRAINT IF EXISTS commercial_document_deliveries_document_type_check/)
  })

  it('contains no DROP of a TABLE, COLUMN, or INDEX — only the two named CONSTRAINT drops above', () => {
    expect(source).not.toMatch(/DROP\s+TABLE/i)
    expect(source).not.toMatch(/DROP\s+COLUMN/i)
    expect(source).not.toMatch(/DROP\s+INDEX/i)
    // Every DROP statement in the file must be a DROP CONSTRAINT.
    const dropLines = source.split('\n').filter(l => /\bDROP\b/i.test(l))
    for (const line of dropLines) {
      expect(line, line).toMatch(/DROP CONSTRAINT/i)
    }
  })

  it('contains no DELETE, TRUNCATE, or backfill of any existing row', () => {
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(source).not.toMatch(/TRUNCATE/i)
    expect(source).not.toMatch(/UPDATE\s+commercial_document_deliveries/i)
  })

  it('never INSERTs a row — schema-only', () => {
    expect(source).not.toMatch(/INSERT INTO/i)
  })
})

describe('Phase C4.3B — the widened CHECK accepts exactly quote and invoice, added back idempotently', () => {
  it('the re-added CHECK constraint is guarded by a pg_constraint existence check (DO block), matching the established C4.1 Section-0 idiom, since ADD CONSTRAINT IF NOT EXISTS is not valid PostgreSQL', () => {
    const doBlocks = source.match(/DO \$\$[\s\S]*?END \$\$;/g) ?? []
    expect(doBlocks.length).toBe(1)
    expect(doBlocks[0]).toMatch(/SELECT 1 FROM pg_constraint WHERE conname = 'commercial_document_deliveries_document_type_check'/)
    expect(doBlocks[0]).toMatch(/CHECK \(document_type IN \('quote', 'invoice'\)\)/)
  })

  it('does not widen to any value beyond quote/invoice (no accidental third value, no typo)', () => {
    const checkMatch = source.match(/CHECK \(document_type IN \(([^)]+)\)\)/)
    expect(checkMatch).not.toBeNull()
    const values = checkMatch![1].split(',').map(v => v.trim())
    expect(values).toEqual(["'quote'", "'invoice'"])
  })
})

describe('Phase C4.3B — no replacement cross-table FK is introduced for document_id', () => {
  it('the migration adds no new FOREIGN KEY / REFERENCES clause at all — document_id remains a bare UUID with no DB-level FK', () => {
    expect(source).not.toMatch(/ADD CONSTRAINT[\s\S]*?FOREIGN KEY/i)
    expect(source).not.toMatch(/REFERENCES commercial_invoices/i)
    expect(source).not.toMatch(/REFERENCES commercial_quotes/i)
  })
})

describe('Phase C4.3B — organisation_id\'s own FK and every existing index are left untouched', () => {
  it('the migration never touches the organisation_id -> organisations(id) FK', () => {
    expect(source).not.toMatch(/organisation_id[\s\S]*organisations/i)
  })

  it('the migration contains no CREATE INDEX / DROP INDEX / ALTER INDEX at all — no index change of any kind, matching the "no proven deficiency" instruction', () => {
    expect(source).not.toMatch(/CREATE INDEX/i)
    expect(source).not.toMatch(/DROP INDEX/i)
    expect(source).not.toMatch(/ALTER INDEX/i)
  })
})

describe('Phase C4.3B — every DROP CONSTRAINT statement in this file is idempotent by construction', () => {
  it('both DROP CONSTRAINT statements use IF EXISTS — safe to replay any number of times', () => {
    const dropConstraintLines = source.split('\n').filter(l => /DROP CONSTRAINT/i.test(l))
    expect(dropConstraintLines.length).toBeGreaterThanOrEqual(2)
    for (const line of dropConstraintLines) {
      expect(line, line).toMatch(/DROP CONSTRAINT IF EXISTS/i)
    }
  })
})
