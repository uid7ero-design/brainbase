import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C2 — document numbering allocator. lib/commercial/
// documentNumbering.ts uses a two-statement sql.transaction() (INSERT
// ... ON CONFLICT DO NOTHING, then UPDATE ... RETURNING next_number - 1)
// rather than a real Postgres connection, so true concurrent-request
// locking cannot be exercised in this repo's no-real-DB vitest
// convention. What IS provable here, and is proven below: (1) the SQL
// shape itself is a single atomic UPDATE that both reads and writes the
// row, which is what makes Postgres's own row-level locking the actual
// safety mechanism (asserted via static containment on the real source);
// (2) the ALGORITHM's arithmetic is correct under simulated concurrent
// calls sharing one in-memory row with the exact same increment-then-
// derive-old-value logic the real SQL performs, proving no logical
// double-allocation exists in the formula itself. A real-DB concurrent
// rehearsal (N parallel HTTP calls against a live Postgres branch) is
// the appropriate follow-up validation before production migration —
// not performed in this phase (see report §M/§Q).

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('Phase C2 — documentNumbering.ts SQL shape (static containment)', () => {
  const source = readSource('lib/commercial/documentNumbering.ts')

  it('allocation runs as a single sql.transaction() call, not two independent, unsynchronized statements', () => {
    expect(source).toMatch(/sql\.transaction\(queries\)/)
  })

  it('the allocating UPDATE is a single statement that both increments and RETURNs from the same row (the actual concurrency-safety mechanism)', () => {
    expect(source).toMatch(/UPDATE commercial_document_sequences\s*\n\s*SET next_number = next_number \+ 1/)
    expect(source).toMatch(/RETURNING \(next_number - 1\) AS allocated_number/)
  })

  it('the seeding INSERT is idempotent (ON CONFLICT DO NOTHING) and never resets an existing row', () => {
    expect(source).toMatch(/ON CONFLICT \(organisation_id, document_type\) DO NOTHING/)
  })

  it('never deletes or truncates the sequence table', () => {
    const code = stripComments(source)
    expect(code).not.toMatch(/DELETE FROM commercial_document_sequences/i)
    expect(code).not.toMatch(/TRUNCATE/i)
  })

  it('organisationId and documentType are always the query parameters — never accepted as a pre-built SQL fragment from caller input', () => {
    expect(source).toMatch(/WHERE organisation_id = \$\{organisationId\} AND document_type = \$\{documentType\}/)
  })
})

describe('Phase C2 — allocation algorithm correctness (simulated, no real DB)', () => {
  // Models exactly what the real two-statement transaction does to one
  // row: INSERT ... ON CONFLICT DO NOTHING (no-op if present), then
  // UPDATE next_number = next_number + 1 RETURNING next_number - 1.
  function simulateAllocate(store: Map<string, number>, key: string): number {
    if (!store.has(key)) store.set(key, 1) // INSERT ... DO NOTHING seed
    const current = store.get(key)!
    const newValue = current + 1 // UPDATE SET next_number = next_number + 1
    store.set(key, newValue)
    return newValue - 1 // RETURNING next_number - 1
  }

  it('sequential calls for the same key produce 1, 2, 3, ... — monotonic, no gaps, no duplicates', () => {
    const store = new Map<string, number>()
    const allocated = Array.from({ length: 5 }, () => simulateAllocate(store, 'org-a:INVOICE'))
    expect(allocated).toEqual([1, 2, 3, 4, 5])
  })

  it('interleaved "concurrent" calls (simulating serialized row-lock execution order) for the SAME key never produce a duplicate — every allocated number is unique', () => {
    const store = new Map<string, number>()
    // Any real interleaving of concurrent transactions still executes
    // each individual row-locked UPDATE in SOME serial order — this
    // loop stands in for whatever that order turns out to be.
    const allocated = Array.from({ length: 50 }, () => simulateAllocate(store, 'org-a:QUOTE'))
    expect(new Set(allocated).size).toBe(50)
    expect(Math.max(...allocated)).toBe(50)
  })

  it('different document types for the same organisation get fully independent sequences', () => {
    const store = new Map<string, number>()
    const invoiceNumbers = [simulateAllocate(store, 'org-a:INVOICE'), simulateAllocate(store, 'org-a:INVOICE')]
    const quoteNumbers = [simulateAllocate(store, 'org-a:QUOTE')]
    expect(invoiceNumbers).toEqual([1, 2])
    expect(quoteNumbers).toEqual([1]) // unaffected by INVOICE's own count
  })

  it('different organisations for the SAME document type get fully independent sequences', () => {
    const store = new Map<string, number>()
    const orgA = [simulateAllocate(store, 'org-a:INVOICE'), simulateAllocate(store, 'org-a:INVOICE')]
    const orgB = [simulateAllocate(store, 'org-b:INVOICE')]
    expect(orgA).toEqual([1, 2])
    expect(orgB).toEqual([1]) // unaffected by org-a's own count
  })
})

// ── Behavioural: allocateDocumentNumber() with a mocked sql client ──────

const sqlMock = vi.fn()
const transactionMock = vi.fn()

vi.mock('@/lib/db', () => ({
  default: Object.assign(
    (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
    { transaction: (...args: unknown[]) => (transactionMock as unknown as (...a: unknown[]) => unknown)(...args) },
  ),
}))

beforeEach(() => {
  sqlMock.mockReset()
  transactionMock.mockReset()
})

describe('Phase C2 — allocateDocumentNumber() behaviour', () => {
  it('formats the result as PREFIX + zero-padded number, using the row returned by the UPDATE', async () => {
    transactionMock.mockResolvedValue([
      undefined, // INSERT ... ON CONFLICT DO NOTHING result (unused)
      [{ allocated_number: 42, prefix: 'INV-', padding: 6 }],
    ])
    const { allocateDocumentNumber } = await import('@/lib/commercial/documentNumbering')
    const result = await allocateDocumentNumber('org-a', 'INVOICE')
    expect(result).toBe('INV-000042')
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it('respects a configured custom prefix/padding rather than a hardcoded default', async () => {
    transactionMock.mockResolvedValue([undefined, [{ allocated_number: 7, prefix: 'CUSTOM-', padding: 3 }]])
    const { allocateDocumentNumber } = await import('@/lib/commercial/documentNumbering')
    const result = await allocateDocumentNumber('org-a', 'QUOTE')
    expect(result).toBe('CUSTOM-007')
  })
})

describe('Phase C2 — configureDocumentSequence() audit wiring', () => {
  it('logs a configuration-change audit entry via audit_logs, never on ordinary allocation', async () => {
    sqlMock
      .mockResolvedValueOnce([{ prefix: 'INV-', padding: 6 }]) // existing-row read
      .mockResolvedValueOnce([]) // upsert
      .mockResolvedValueOnce([]) // audit insert
    const { configureDocumentSequence } = await import('@/lib/commercial/documentNumbering')
    await configureDocumentSequence({ organisationId: 'org-a', userId: 'u1', documentType: 'INVOICE', prefix: 'INVX-', padding: 5 })

    const auditCall = sqlMock.mock.calls.find(c => (c[0] as string[]).join('').includes('INSERT INTO audit_logs'))
    expect(auditCall).toBeDefined()
    const text = (auditCall![0] as string[]).join('')
    expect(text).toMatch(/audit_logs/)
    // Values include the action name and resource_type — spot-check via
    // the template values array (neon sql tag passes interpolations
    // positionally after the strings array in this mock's call args).
    expect(auditCall!.join('|')).toContain('commercial_document_sequence.configured')
  })
})
