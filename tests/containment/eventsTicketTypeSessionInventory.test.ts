import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// Events Phase 3 — ticket type × session inventory. Mocked-SQL suite:
// proves the migration's shape, the shared pair-aware gate and lock
// order every reservation flow submits, the organiser API's role/tenant
// gating and audit rows, the public payload, and the two clients'
// precedence handling. Real behaviour that needs constraints, locks and
// MVCC (cross-org / cross-event / duplicate pair rejection, pair
// oversell, shared session cap, all-or-nothing carts, stale holds,
// retry, deadlock freedom) is proven against real PostgreSQL by
// scripts/tests/verify-events-ticket-type-session-inventory.sh — mocks
// cannot prove any of those, so this file only guards that the proof
// script stays in step with the live SQL.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
function stripSqlLineComments(sql: string): string {
  return sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n')
}
function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}
function jsonReq(url: string, method: string, body?: unknown) {
  return asNextRequest(new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined }))
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
const transactionMock = vi.fn(async (queries: unknown[]) => queries.map(() => []))
;(sqlMock as unknown as { transaction: typeof transactionMock }).transaction = transactionMock
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: vi.fn().mockResolvedValue({ key: 'events', config: {} }) }
})
const EVENT = {
  id: 'event-1', organisation_id: 'org-a', name: 'Gala', slug: 'gala', description: null, venue: null,
  artwork_url: null, starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T12:00:00Z', timezone: 'Australia/Adelaide',
}
vi.mock('@/lib/events/publicResolve', () => ({
  resolvePublicEvent: vi.fn(async () => ({ ok: true, organisationId: 'org-a', organisationName: 'Org A', event: EVENT, branding: { accentColor: null } })),
}))
vi.mock('@/lib/events/registrationQuestions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/registrationQuestions')>()
  return { ...actual, listActiveQuestions: vi.fn(async () => []) }
})

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function callText(index: number): string {
  return ((sqlMock.mock.calls[index] as unknown as unknown[])[0] as TemplateStringsArray).join(' ')
}
function callArgs(index: number): unknown[] {
  return (sqlMock.mock.calls[index] as unknown as unknown[]).slice(1)
}
function allTexts(): string[] {
  return sqlMock.mock.calls.map((_, i) => callText(i))
}
function auditInserts() {
  return (sqlMock.mock.calls as unknown as unknown[][])
    .filter(c => (c[0] as TemplateStringsArray).join(' ').includes('INSERT INTO audit_logs'))
    .map(c => ({
      organisationId: c[2], userId: c[3], action: c[4], resourceType: c[5], resourceId: c[6],
      before: c[7] ? JSON.parse(c[7] as string) : null,
      after: c[8] ? JSON.parse(c[8] as string) : null,
    }))
}
function sessionAs(role: string, organisationId = 'org-a', userId = 'staff-1') { return { userId, organisationId, role } }

const { buildCartLockStatements } = await import('@/lib/events/services/cart')
const { validateEventTicketTypeSessionInventoryInput } = await import('@/lib/events/validation')
const { getPublicEventDetail } = await import('@/lib/events/publicEventDetail')
const inventoryListRoute = await import('@/app/api/events/[id]/sessions/[sessionId]/inventory/route')
const inventoryPairRoute = await import('@/app/api/events/[id]/sessions/[sessionId]/inventory/[ticketTypeId]/route')

const LIST_CTX = { params: Promise.resolve({ id: 'event-1', sessionId: 'sess-fri' }) }
const PAIR_CTX = { params: Promise.resolve({ id: 'event-1', sessionId: 'sess-fri', ticketTypeId: 'tt-adult' }) }
const PAIR_URL = 'http://localhost/api/events/event-1/sessions/sess-fri/inventory/tt-adult'
const OWNED_PAIR = [{ session_id: 'sess-fri', ticket_type_id: 'tt-adult' }]
const UPSERTED = (capacity: number, prior: number | null) => [{
  id: 'inv-1', organisation_id: 'org-a', event_id: 'event-1', ticket_type_id: 'tt-adult', event_session_id: 'sess-fri',
  capacity, created_at: '2026-10-15T00:00:00.000Z', updated_at: '2026-10-15T00:00:00.000Z', prior_capacity: prior,
}]

beforeEach(() => {
  sqlMock.mockClear()
  transactionMock.mockClear()
  requireSessionMock.mockReset()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
})

// ─── SCHEMA / TENANT ───────────────────────────────────────────────────

describe('scripts/create-events-ticket-type-session-inventory.sql — additive, idempotent, database-enforced tenant/event integrity', () => {
  const raw = read('scripts/create-events-ticket-type-session-inventory.sql')
  const live = stripSqlLineComments(raw)

  it('creates exactly one new table, idempotently, with every column NOT NULL and the capacity CHECK >= 0', () => {
    expect(live.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(1)
    expect(live).toMatch(/CREATE TABLE IF NOT EXISTS event_ticket_type_session_inventory \(/)
    for (const col of ['organisation_id', 'event_id', 'ticket_type_id', 'event_session_id']) {
      expect(live).toMatch(new RegExp(`\\n\\s+${col}\\s+TEXT\\s+NOT NULL`))
    }
    expect(live).toMatch(/capacity\s+INTEGER\s+NOT NULL CHECK \(capacity >= 0\)/)
    // No nullable capacity and no "unlimited" sentinel — clearing is a DELETE.
    expect(live).not.toMatch(/capacity\s+INTEGER\s*,/)
    expect(live).not.toMatch(/capacity\s+INTEGER\s+NULL/)
    expect(live).not.toMatch(/-1|unlimited/i)
  })

  it('adds the two parent UNIQUE(id, event_id, organisation_id) constraints additively via pg_constraint-guarded DO blocks', () => {
    expect(live).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint WHERE conname = 'event_ticket_types_id_event_org_key'\s*\) THEN\s*ALTER TABLE event_ticket_types\s*ADD CONSTRAINT event_ticket_types_id_event_org_key UNIQUE \(id, event_id, organisation_id\)/)
    expect(live).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint WHERE conname = 'event_sessions_id_event_org_key'\s*\) THEN\s*ALTER TABLE event_sessions\s*ADD CONSTRAINT event_sessions_id_event_org_key UNIQUE \(id, event_id, organisation_id\)/)
  })

  it('touches no existing column, row or constraint (no DROP, no ALTER COLUMN, no ADD COLUMN, no UPDATE/DELETE) outside the commented rollback block', () => {
    expect(live).not.toMatch(/\bDROP\b/i)
    expect(live).not.toMatch(/ALTER COLUMN|ADD COLUMN|RENAME/i)
    expect(live).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\b/im)
    expect(live).not.toMatch(/::uuid/i)
    // The ALTER TABLEs are the two ADD CONSTRAINTs and nothing else.
    expect(live.match(/ALTER TABLE/g)).toHaveLength(2)
  })

  it('the pair row composite-FKs BOTH parents on (foreign_id, event_id, organisation_id) — so a pair cannot cross organisations OR events — plus the event itself', () => {
    expect(live).toMatch(/CONSTRAINT event_tt_session_inventory_event_org_fkey FOREIGN KEY \(event_id, organisation_id\)\s*REFERENCES events \(id, organisation_id\) ON DELETE CASCADE/)
    expect(live).toMatch(/CONSTRAINT event_tt_session_inventory_ticket_type_fkey FOREIGN KEY \(ticket_type_id, event_id, organisation_id\)\s*REFERENCES event_ticket_types \(id, event_id, organisation_id\) ON DELETE CASCADE/)
    expect(live).toMatch(/CONSTRAINT event_tt_session_inventory_session_fkey FOREIGN KEY \(event_session_id, event_id, organisation_id\)\s*REFERENCES event_sessions \(id, event_id, organisation_id\) ON DELETE CASCADE/)
    // Never a bare single-column FK that would let organisation/event drift.
    expect(live).not.toMatch(/FOREIGN KEY \(ticket_type_id\)\s*REFERENCES/)
    expect(live).not.toMatch(/FOREIGN KEY \(event_session_id\)\s*REFERENCES/)
  })

  it('one override per (ticket type, session) pair within an organisation, and the usual (id, organisation_id) UNIQUE', () => {
    expect(live).toMatch(/CONSTRAINT event_tt_session_inventory_pair_key UNIQUE \(ticket_type_id, event_session_id, organisation_id\)/)
    expect(live).toMatch(/CONSTRAINT event_tt_session_inventory_id_org_key UNIQUE \(id, organisation_id\)/)
  })

  it('documents the manual-only discipline, NOT Production, and the rollback in children-first order', () => {
    expect(raw).toMatch(/Run\s*\n?--\s*once, manually/)
    expect(raw).toMatch(/NOT executed against Production/)
    const rollbackIdx = raw.indexOf('-- ROLLBACK')
    expect(rollbackIdx).toBeGreaterThan(-1)
    const rollback = raw.slice(rollbackIdx, rollbackIdx + 700)
    expect(rollback.indexOf('DROP TABLE IF EXISTS event_ticket_type_session_inventory')).toBeLessThan(rollback.indexOf('DROP CONSTRAINT IF EXISTS event_ticket_types_id_event_org_key'))
    expect(rollback.indexOf('DROP CONSTRAINT IF EXISTS event_ticket_types_id_event_org_key')).toBeLessThan(rollback.indexOf('DROP CONSTRAINT IF EXISTS event_sessions_id_event_org_key'))
  })

  it('prisma/schema.prisma mirrors the table (docs-only mirror, same convention as every Events model)', () => {
    const schema = read('prisma/schema.prisma')
    const start = schema.indexOf('model EventTicketTypeSessionInventory {')
    expect(start).toBeGreaterThan(-1)
    const block = schema.slice(start, schema.indexOf('\n}', start))
    expect(block).toMatch(/@@map\("event_ticket_type_session_inventory"\)/)
    expect(block).toMatch(/@@unique\(\[ticket_type_id, event_session_id, organisation_id\]\)/)
    expect(block).toMatch(/@relation\(fields: \[ticket_type_id, event_id, organisation_id\], references: \[id, event_id, organisation_id\], onDelete: Cascade\)/)
    expect(block).toMatch(/@relation\(fields: \[event_session_id, event_id, organisation_id\], references: \[id, event_id, organisation_id\], onDelete: Cascade\)/)
    for (const model of ['EventSession', 'EventTicketType']) {
      const ms = schema.indexOf(`model ${model} {`)
      const mb = schema.slice(ms, schema.indexOf('\n}', ms))
      expect(mb).toMatch(/@@unique\(\[id, event_id, organisation_id\]\)/)
    }
  })

  it('every real-Postgres harness that exercises the live gate applies the new migration', () => {
    expect(read('scripts/tests/verify-events-cart-concurrency.sh')).toMatch(/create-events-ticket-type-session-inventory\.sql/)
    expect(read('scripts/tests/verify-events-ticket-type-session-inventory.sh')).toMatch(/create-events-ticket-type-session-inventory\.sql/)
    expect(read('tests/containment/eventsExpiryCasPrecisionRealPostgres.test.ts')).toMatch(/'scripts\/create-events-ticket-type-session-inventory\.sql'/)
  })
})

// ─── FALLBACK PRECEDENCE (shared gate) ────────────────────────────────

describe('reservation gate — pair override wins, otherwise event-wide ticket-type capacity; session cap unchanged', () => {
  const services = {
    free: read('lib/events/services/freeRegistration.ts'),
    paid: read('lib/events/services/paidCheckout.ts'),
    retry: read('lib/events/services/retryCheckout.ts'),
  }

  for (const [name, src] of Object.entries(services)) {
    it(`${name}: cart_tt resolves capacity as COALESCE(inv.capacity, tt.capacity) via a LEFT JOIN on the selected session's pair row`, () => {
      expect(src).toContain('COALESCE(inv.capacity, tt.capacity) AS capacity')
      expect(src).toMatch(/LEFT JOIN event_ticket_type_session_inventory inv\s*\n\s*ON inv\.ticket_type_id = c\.ticket_type_id AND inv\.event_session_id = \$\{[a-zA-Z_.]+\} AND inv\.organisation_id = \$\{organisationId\}/)
    })

    it(`${name}: "sold" is narrowed to the pair ONLY when an override row exists — otherwise it stays the event-wide aggregate`, () => {
      expect(src).toMatch(/AND \(inv\.id IS NULL OR oi\.event_session_id = \$\{[a-zA-Z_.]+\}\)/)
    })

    it(`${name}: the all-lines gate, line-count guard, stale-hold predicate and shared session cap are unchanged`, () => {
      expect(src).toContain('NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)')
      expect(src).toMatch(/\(SELECT count\(\*\) FROM cart_tt\) = \$\{/)
      expect(src).toContain("(eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())")
      expect(src).toMatch(/sold_sess\.qty \+ \$\{[a-zA-Z_.]+\} <= \(SELECT capacity FROM event_sessions WHERE id = \$\{[a-zA-Z_.]+\} AND organisation_id = \$\{organisationId\}\)/)
    })
  }

  it('retry still excludes the order itself from the pair-aware aggregate', () => {
    const cartTt = services.retry.match(/cart_tt AS \([\s\S]*?\),\s*sold_sess/)?.[0] ?? ''
    expect(cartTt).toMatch(/eo\.id <> \$\{orderId\}/)
    expect(cartTt).toContain('COALESCE(inv.capacity, tt.capacity)')
  })

  it('the event-wide ticket-type capacity is never ALSO applied on top of an override (the override replaces it)', () => {
    for (const src of Object.values(services)) {
      const cartTt = src.match(/cart_tt AS \([\s\S]*?\),\s*sold_sess/)?.[0] ?? ''
      expect(cartTt).not.toMatch(/LEAST\(/)
      expect(cartTt).not.toMatch(/tt\.capacity\s*,\s*inv\.capacity/)
    }
  })
})

// ─── LOCK ORDER ────────────────────────────────────────────────────────

describe('buildCartLockStatements — ticket types asc, then pair rows asc, then the session', () => {
  it('no session: one FOR UPDATE per ticket type in ascending id order, nothing else', () => {
    const statements = buildCartLockStatements('org-a', ['tt-vip', 'tt-adult', 'tt-child'], null)
    expect(statements).toHaveLength(3)
    expect(allTexts().every(t => /FROM event_ticket_types WHERE id = .* FOR UPDATE/.test(t))).toBe(true)
    expect([0, 1, 2].map(i => callArgs(i)[0])).toEqual(['tt-adult', 'tt-child', 'tt-vip'])
    expect(allTexts().some(t => /event_ticket_type_session_inventory|event_sessions/.test(t))).toBe(false)
  })

  it('session-bound: types asc, then each (type, session) inventory row in the SAME order, then the session — 2N+1 statements', () => {
    const statements = buildCartLockStatements('org-a', ['tt-vip', 'tt-adult'], 'sess-fri')
    expect(statements).toHaveLength(5)
    expect(callText(0)).toMatch(/FROM event_ticket_types WHERE id = .* FOR UPDATE/)
    expect(callText(1)).toMatch(/FROM event_ticket_types WHERE id = .* FOR UPDATE/)
    expect([0, 1].map(i => callArgs(i)[0])).toEqual(['tt-adult', 'tt-vip'])
    expect(callText(2)).toMatch(/FROM event_ticket_type_session_inventory WHERE ticket_type_id = .* AND event_session_id = .* AND organisation_id = .* FOR UPDATE/)
    expect(callText(3)).toMatch(/FROM event_ticket_type_session_inventory WHERE ticket_type_id = .* FOR UPDATE/)
    expect([2, 3].map(i => callArgs(i)[0])).toEqual(['tt-adult', 'tt-vip'])
    expect([2, 3].map(i => callArgs(i)[1])).toEqual(['sess-fri', 'sess-fri'])
    expect(callText(4)).toMatch(/FROM event_sessions WHERE id = .* FOR UPDATE/)
    expect(callArgs(4)[0]).toBe('sess-fri')
  })

  it('every lock statement is a plain FOR UPDATE row lock — no aggregate, no write', () => {
    buildCartLockStatements('org-a', ['tt-a', 'tt-b'], 'sess-1')
    for (const t of allTexts()) {
      expect(t).toMatch(/FOR UPDATE/)
      expect(t).not.toMatch(/SUM\(|INSERT|UPDATE event|DELETE/)
    }
  })
})

// ─── UI / API — organiser configuration ───────────────────────────────

describe('PUT /api/events/[id]/sessions/[sessionId]/inventory/[ticketTypeId] — manager sets an override', () => {
  it('upserts the pair row (ON CONFLICT on the pair key), returns it, and audits `.set` with a null before-state on first set', async () => {
    queue(OWNED_PAIR, UPSERTED(4, null))
    const res = await inventoryPairRoute.PUT(jsonReq(PAIR_URL, 'PUT', { capacity: 4 }), PAIR_CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inventory).toMatchObject({ id: 'inv-1', ticket_type_id: 'tt-adult', event_session_id: 'sess-fri', capacity: 4 })
    expect(body.inventory.prior_capacity).toBeUndefined()

    // Call 0 resolves the triple inside the caller's organisation.
    expect(callText(0)).toMatch(/FROM events e\s*\n\s*JOIN event_sessions es ON es\.event_id = e\.id AND es\.organisation_id = e\.organisation_id AND es\.id = /)
    expect(callText(0)).toMatch(/JOIN event_ticket_types tt ON tt\.event_id = e\.id AND tt\.organisation_id = e\.organisation_id AND tt\.id = /)
    expect(callText(0)).toMatch(/WHERE e\.id = .* AND e\.organisation_id = /)
    expect(callArgs(0)).toEqual(['sess-fri', 'tt-adult', 'event-1', 'org-a'])
    // Call 1 is the upsert.
    expect(callText(1)).toMatch(/INSERT INTO event_ticket_type_session_inventory \(organisation_id, event_id, ticket_type_id, event_session_id, capacity\)/)
    expect(callText(1)).toMatch(/ON CONFLICT \(ticket_type_id, event_session_id, organisation_id\)\s*\n?\s*DO UPDATE SET capacity = EXCLUDED\.capacity, updated_at = now\(\)/)
    expect(callArgs(1)).toContain(4)
    expect(callArgs(1)).toContain('org-a')

    const audits = auditInserts()
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      organisationId: 'org-a', userId: 'staff-1', action: 'event_ticket_type_session_inventory.set',
      resourceType: 'event_ticket_type_session_inventory', resourceId: 'inv-1', before: null,
      after: { event_id: 'event-1', ticket_type_id: 'tt-adult', event_session_id: 'sess-fri', capacity: 4 },
    })
  })

  it('changing an existing override audits the prior capacity as before-state', async () => {
    queue(OWNED_PAIR, UPSERTED(6, 4))
    const res = await inventoryPairRoute.PUT(jsonReq(PAIR_URL, 'PUT', { capacity: 6 }), PAIR_CTX)
    expect(res.status).toBe(200)
    const audits = auditInserts()
    expect(audits).toHaveLength(1)
    expect(audits[0].before).toEqual({ event_id: 'event-1', ticket_type_id: 'tt-adult', event_session_id: 'sess-fri', capacity: 4 })
    expect(audits[0].after).toEqual({ event_id: 'event-1', ticket_type_id: 'tt-adult', event_session_id: 'sess-fri', capacity: 6 })
  })

  it('re-setting the same capacity writes no audit row (no content-free no-op entries)', async () => {
    queue(OWNED_PAIR, UPSERTED(4, 4))
    const res = await inventoryPairRoute.PUT(jsonReq(PAIR_URL, 'PUT', { capacity: 4 }), PAIR_CTX)
    expect(res.status).toBe(200)
    expect(auditInserts()).toHaveLength(0)
  })

  it('capacity 0 is a valid override (nothing bookable for the pair) — never reinterpreted as unlimited', async () => {
    queue(OWNED_PAIR, UPSERTED(0, null))
    const res = await inventoryPairRoute.PUT(jsonReq(PAIR_URL, 'PUT', { capacity: 0 }), PAIR_CTX)
    expect(res.status).toBe(200)
    expect(callArgs(1)).toContain(0)
  })

  for (const bad of [-1, 1.5, '4', null, undefined]) {
    it(`rejects capacity ${JSON.stringify(bad)} with 400 before any write`, async () => {
      queue(OWNED_PAIR)
      const res = await inventoryPairRoute.PUT(jsonReq(PAIR_URL, 'PUT', bad === undefined ? {} : { capacity: bad }), PAIR_CTX)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Capacity must be a non-negative whole number.')
      expect(allTexts().some(t => /INSERT INTO event_ticket_type_session_inventory/.test(t))).toBe(false)
      expect(auditInserts()).toHaveLength(0)
    })
  }

  it('invalid JSON body -> 400', async () => {
    queue(OWNED_PAIR)
    const req = asNextRequest(new Request(PAIR_URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{not json' }))
    const res = await inventoryPairRoute.PUT(req, PAIR_CTX)
    expect(res.status).toBe(400)
  })

  it('a session or ticket type outside the caller\'s organisation / event resolves to nothing -> 404, no write, no audit', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('manager', 'org-b'))
    queue([] /* loadOwnedPair: nothing in org-b */)
    const res = await inventoryPairRoute.PUT(jsonReq(PAIR_URL, 'PUT', { capacity: 4 }), PAIR_CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(callArgs(0)).toContain('org-b')
    expect(auditInserts()).toHaveLength(0)
  })

  it('viewer -> 403, no SQL at all', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await inventoryPairRoute.PUT(jsonReq(PAIR_URL, 'PUT', { capacity: 4 }), PAIR_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('unauthenticated -> 401', async () => {
    requireSessionMock.mockRejectedValue(new Error('no session'))
    const res = await inventoryPairRoute.PUT(jsonReq(PAIR_URL, 'PUT', { capacity: 4 }), PAIR_CTX)
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/events/[id]/sessions/[sessionId]/inventory/[ticketTypeId] — manager clears an override', () => {
  it('deletes the pair row scoped by type, session, event AND organisation, and audits `.cleared` with the removed capacity', async () => {
    queue([{ id: 'inv-1', capacity: 4 }])
    const res = await inventoryPairRoute.DELETE(jsonReq(PAIR_URL, 'DELETE'), PAIR_CTX)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(callText(0)).toMatch(/DELETE FROM event_ticket_type_session_inventory\s*\n\s*WHERE ticket_type_id = .* AND event_session_id = .* AND event_id = .* AND organisation_id = .*\s*\n\s*RETURNING id, capacity/)
    expect(callArgs(0)).toEqual(['tt-adult', 'sess-fri', 'event-1', 'org-a'])
    const audits = auditInserts()
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      action: 'event_ticket_type_session_inventory.cleared', resourceType: 'event_ticket_type_session_inventory', resourceId: 'inv-1',
      before: { event_id: 'event-1', ticket_type_id: 'tt-adult', event_session_id: 'sess-fri', capacity: 4 }, after: null,
    })
  })

  it('clearing a pair with no override -> 404, no audit', async () => {
    queue([])
    const res = await inventoryPairRoute.DELETE(jsonReq(PAIR_URL, 'DELETE'), PAIR_CTX)
    expect(res.status).toBe(404)
    expect(auditInserts()).toHaveLength(0)
  })

  it('wrong organisation -> 404 (the DELETE is organisation-scoped and matches nothing)', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('manager', 'org-b'))
    queue([])
    const res = await inventoryPairRoute.DELETE(jsonReq(PAIR_URL, 'DELETE'), PAIR_CTX)
    expect(res.status).toBe(404)
    expect(callArgs(0)).toContain('org-b')
  })

  it('viewer -> 403, no SQL', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await inventoryPairRoute.DELETE(jsonReq(PAIR_URL, 'DELETE'), PAIR_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/events/[id]/sessions/[sessionId]/inventory — per-type effective capacity, sold and remaining for one session', () => {
  const SESSION = [{ id: 'sess-fri', name: 'Friday', capacity: 6, sold: 4 }]
  const ROWS = [
    { ticket_type_id: 'tt-adult', ticket_type_name: 'Adult', active: true, type_capacity: 50, inventory_id: 'inv-1', override_capacity: 4, effective_capacity: 4, sold: 2 },
    { ticket_type_id: 'tt-child', ticket_type_name: 'Child', active: true, type_capacity: 3, inventory_id: null, override_capacity: null, effective_capacity: 3, sold: 2 },
  ]

  it('viewer may read; rows carry the event-wide capacity, the override (or null), the COALESCEd effective capacity, sold and remaining', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    queue(SESSION, ROWS)
    const res = await inventoryListRoute.GET(jsonReq('http://localhost/x', 'GET'), LIST_CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.event_session).toEqual({ id: 'sess-fri', name: 'Friday', capacity: 6, sold: 4, remaining: 2 })
    expect(body.inventory).toHaveLength(2)
    expect(body.inventory[0]).toMatchObject({ ticket_type_id: 'tt-adult', type_capacity: 50, override_capacity: 4, effective_capacity: 4, sold: 2, remaining: 2 })
    expect(body.inventory[1]).toMatchObject({ ticket_type_id: 'tt-child', override_capacity: null, effective_capacity: 3, sold: 2, remaining: 1 })
    // The SQL applies the same precedence + stale-hold predicate as the gate.
    expect(callText(1)).toMatch(/COALESCE\(inv\.capacity, tt\.capacity\)::int AS effective_capacity/)
    expect(callText(1)).toMatch(/LEFT JOIN event_ticket_type_session_inventory inv\s*\n\s*ON inv\.ticket_type_id = tt\.id AND inv\.event_session_id = .* AND inv\.organisation_id = tt\.organisation_id/)
    expect(callText(1)).toMatch(/oi\.ticket_type_id = tt\.id AND oi\.event_session_id = .* AND oi\.organisation_id = /)
    expect(callText(1)).toContain("(eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())")
    expect(callText(1)).toMatch(/WHERE tt\.event_id = .* AND tt\.organisation_id = /)
  })

  it('session of another event/organisation -> 404 before the per-type query', async () => {
    queue([])
    const res = await inventoryListRoute.GET(jsonReq('http://localhost/x', 'GET'), LIST_CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(callText(0)).toMatch(/WHERE es\.id = .* AND es\.event_id = .* AND es\.organisation_id = /)
  })
})

describe('validateEventTicketTypeSessionInventoryInput', () => {
  it('accepts non-negative whole numbers only', () => {
    expect(validateEventTicketTypeSessionInventoryInput({ capacity: 0 })).toBeNull()
    expect(validateEventTicketTypeSessionInventoryInput({ capacity: 12 })).toBeNull()
    for (const bad of [-1, 2.5, '3', null, undefined, NaN]) {
      expect(validateEventTicketTypeSessionInventoryInput({ capacity: bad })).toBe('Capacity must be a non-negative whole number.')
    }
  })
})

// ─── PUBLIC AVAILABILITY ──────────────────────────────────────────────

describe('getPublicEventDetail — session_inventory payload', () => {
  it('returns one row per override pair of an ACTIVE ticket type, with pair-narrowed remaining cast to ::int', async () => {
    queue(
      [{ id: 'sess-fri', name: 'Friday', starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T11:00:00Z', capacity: 6, remaining: 2 }],
      [{ id: 'tt-adult', name: 'Adult', description: null, price_cents: 2500, capacity: 50, remaining: 46 }],
      [{ ticket_type_id: 'tt-adult', event_session_id: 'sess-fri', capacity: 4, remaining: 2 }],
    )
    const result = await getPublicEventDetail('org', 'gala')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.session_inventory).toEqual([{ ticket_type_id: 'tt-adult', event_session_id: 'sess-fri', capacity: 4, remaining: 2 }])
    const inventoryQuery = callText(2)
    expect(inventoryQuery).toMatch(/FROM event_ticket_type_session_inventory inv/)
    expect(inventoryQuery).toMatch(/JOIN event_ticket_types tt ON tt\.id = inv\.ticket_type_id AND tt\.organisation_id = inv\.organisation_id AND tt\.active = true/)
    expect(inventoryQuery).toMatch(/oi\.ticket_type_id = inv\.ticket_type_id AND oi\.event_session_id = inv\.event_session_id AND oi\.organisation_id = /)
    expect(inventoryQuery).toContain("(eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())")
    expect(inventoryQuery).toMatch(/\)::int AS remaining/)
    expect(inventoryQuery).toMatch(/WHERE inv\.event_id = .* AND inv\.organisation_id = /)
    // Never leaks organisation ids or override row ids to the public.
    expect(inventoryQuery).not.toMatch(/SELECT\s*\n?\s*inv\.id/)
  })

  it('the existing session and ticket-type remaining queries are unchanged (event-wide, same predicate)', async () => {
    queue([], [], [])
    await getPublicEventDetail('org', 'gala')
    expect(callText(0)).toMatch(/oi\.event_session_id = es\.id/)
    expect(callText(1)).toMatch(/oi\.ticket_type_id = tt\.id AND oi\.organisation_id = /)
    expect(callText(1)).not.toMatch(/event_session_id/)
  })
})

describe('PublicEventClient — selected-session availability precedence', () => {
  const src = stripComments(read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx'))

  it('resolves a ticket type\'s remaining as: pair override for the selected session if present, else the event-wide figure; no session -> event-wide', () => {
    expect(src).toMatch(/function remainingFor\(t: PublicTicketType, forSessionId: string\): number \{\s*if \(!forSessionId\) return t\.remaining;\s*const pair = sessionInventory\.find\(p => p\.ticket_type_id === t\.id && p\.event_session_id === forSessionId\);\s*return pair \? pair\.remaining : t\.remaining;/)
    expect(src).toMatch(/const displayTicketTypes = ticketTypes\.map\(t => \(sessionId \? \{ \.\.\.t, remaining: remainingFor\(t, sessionId\) \} : t\)\)/)
    // The steppers render the session-resolved list, not the raw one.
    expect(src).toMatch(/\{displayTicketTypes\.map\(t => \(\s*<TicketQuantityRow/)
  })

  it('the stepper max also respects the selected session\'s shared remaining across the whole cart', () => {
    const fn = src.slice(src.indexOf('function maxFor('), src.indexOf('function isPricingBlocked('))
    expect(fn).toMatch(/const sessionBound = selectedSession \? selectedSession\.remaining - others : Number\.POSITIVE_INFINITY/)
    expect(fn).toMatch(/Math\.min\(t\.remaining, MAX_ORDER_TICKETS - others, sessionBound\)/)
  })

  it('changing session goes through selectSession(), which re-clamps every quantity to the new session\'s availability', () => {
    expect(src).toMatch(/onChange=\{\(\) => selectSession\(''\)\}/)
    expect(src).toMatch(/onSelect=\{\(\) => selectSession\(s\.id\)\}/)
    expect(src).not.toMatch(/onSelect=\{\(\) => setSessionId\(s\.id\)\}/)
    const fn = src.slice(src.indexOf('function selectSession('), src.indexOf('let stepCounter'))
    expect(fn).toMatch(/remainingFor\(t, nextSessionId\)/)
    expect(fn).toMatch(/nextSession\.remaining - used/)
  })

  it('the submitted cart shape is unchanged (items + order-level event_session_id) — no new client-supplied capacity data', () => {
    expect(src).toMatch(/items: cartLines\.map\(l => \(\{ ticket_type_id: l\.ticket\.id, quantity: l\.quantity \}\)\)/)
    expect(src).toMatch(/event_session_id: sessionId \|\| undefined/)
    expect(src).not.toMatch(/session_inventory:/)
  })
})

// ─── ORGANISER UI ─────────────────────────────────────────────────────

describe('EventDetailClient — Session inventory disclosure inside the Sessions panel', () => {
  const src = stripComments(read('app/events/[id]/EventDetailClient.tsx'))

  it('each session row has an Inventory toggle rendering SessionInventoryTable (viewer and manager alike)', () => {
    expect(src).toMatch(/\{inventoryOpenId === s\.id \? 'Hide inventory' : 'Inventory'\}/)
    expect(src).toMatch(/\{inventoryOpenId === s\.id && \(\s*<SessionInventoryTable eventId=\{eventId\} session=\{s\} canManage=\{canManage\} \/>/)
  })

  it('reads from the inventory endpoint and shows "Event-wide (N)" for a type with no override', () => {
    const fn = src.slice(src.indexOf('function SessionInventoryTable('), src.indexOf('function TicketTypesPanel('))
    expect(fn).toMatch(/fetch\(`\/api\/events\/\$\{eventId\}\/sessions\/\$\{session\.id\}\/inventory`\)/)
    expect(fn).toMatch(/Event-wide \(\{row\.type_capacity\}\)/)
    expect(fn).toMatch(/\(session override\)/)
  })

  it('Set uses PUT with { capacity } and Clear uses DELETE on the pair endpoint — both only rendered for managers', () => {
    const fn = src.slice(src.indexOf('function SessionInventoryTable('), src.indexOf('function TicketTypesPanel('))
    expect(fn).toMatch(/fetch\(`\/api\/events\/\$\{eventId\}\/sessions\/\$\{session\.id\}\/inventory\/\$\{row\.ticket_type_id\}`, \{\s*method: 'PUT'/)
    expect(fn).toMatch(/body: JSON\.stringify\(\{ capacity \}\)/)
    expect(fn).toMatch(/fetch\(`\/api\/events\/\$\{eventId\}\/sessions\/\$\{session\.id\}\/inventory\/\$\{row\.ticket_type_id\}`, \{ method: 'DELETE' \}\)/)
    expect(fn).toMatch(/\{canManage && <th style=\{headStyle\}>Override<\/th>\}/)
    expect(fn).toMatch(/\{canManage && \(\s*<td style=\{cellStyle\}>/)
  })

  it('does not reinterpret ticket-type or session capacity anywhere else (CapacityPill and both forms unchanged)', () => {
    expect(src).toMatch(/<CapacityPill registered=\{orders \? registeredQuantity\(orders, o => o\.event_session_id === s\.id\) : null\} capacity=\{s\.capacity\} \/>/)
    expect(src).toMatch(/<CapacityPill registered=\{orders \? registeredQuantity\(orders, o => o\.ticket_type_id === tt\.id\) : null\} capacity=\{tt\.capacity\} \/>/)
  })
})

// ─── CONTAINMENT ──────────────────────────────────────────────────────

describe('Phase 3 containment — scope, roles, tenant scoping, audit pattern', () => {
  const NEW_FILES = [
    'app/api/events/[id]/sessions/[sessionId]/inventory/route.ts',
    'app/api/events/[id]/sessions/[sessionId]/inventory/[ticketTypeId]/route.ts',
  ]

  it('GET is viewer+, PUT/DELETE are manager+, via authorizeEventsRequest', () => {
    const list = stripComments(read(NEW_FILES[0]))
    const pair = stripComments(read(NEW_FILES[1]))
    expect(list).toMatch(/authorizeEventsRequest\('viewer'\)/)
    expect(list).not.toMatch(/authorizeEventsRequest\('manager'\)/)
    expect((pair.match(/authorizeEventsRequest\('manager'\)/g) ?? []).length).toBe(2)
    expect(pair).not.toMatch(/authorizeEventsRequest\('viewer'\)/)
  })

  for (const file of NEW_FILES) {
    it(`${file} scopes every statement by organisation_id, never casts ::uuid, and never trusts a client-supplied organisation`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/::uuid/i)
      expect(code).not.toMatch(/body\.organisation_id|organisationId: body/)
      const statements = code.split(/sql`/).slice(1)
      for (const s of statements) expect(s).toMatch(/organisation_id/)
    })

    it(`${file} has no seating, promo, GST, fee, allocation/hold, recurrence, Stripe or Eve scope creep`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/seat|row_number|promo|coupon|gst|tax|fee|allocation|hold_|recurr|stripe|eve\b/i)
    })
  }

  it('audit actions follow the <resource_type>.<verb> pattern through the shared insertAuditLog, with an allowlisted, PII-free state shape', () => {
    const audit = stripComments(read('lib/events/auditLog.ts'))
    expect(audit).toMatch(/action: 'event_ticket_type_session_inventory\.set'/)
    expect(audit).toMatch(/action: 'event_ticket_type_session_inventory\.cleared'/)
    expect(audit).toMatch(/resourceType: 'event_ticket_type_session_inventory'/)
    const block = audit.slice(audit.indexOf('export async function logEventTicketTypeSessionInventorySet'), audit.indexOf('export async function logStripeConnectOnboardingInitiated'))
    expect(block).not.toMatch(/purchaser|email|phone|stripe/i)
  })

  it('no mixed free/paid, pricing, or order-shape change: publicValidation.ts and cart.ts rules are untouched apart from the lock statements', () => {
    const cart = stripComments(read('lib/events/services/cart.ts'))
    expect(cart).toMatch(/MIXED_FREE_AND_PAID/)
    expect(cart).toMatch(/CURRENCY_MISMATCH/)
    expect(cart).toMatch(/export function cartLockOrder\(ticketTypeIds: string\[\]\): string\[\] \{\s*return \[\.\.\.ticketTypeIds\]\.sort/)
    const pv = stripComments(read('lib/events/publicValidation.ts'))
    expect(pv).not.toMatch(/session_inventory|override/)
  })
})

// ─── DRIFT GUARD: the real-Postgres proof mirrors the live statements ──

describe('scripts/tests/verify-events-ticket-type-session-inventory.sh mirrors the live pair-aware SQL', () => {
  const proof = read('scripts/tests/verify-events-ticket-type-session-inventory.sh')
  const cartProof = read('scripts/tests/verify-events-cart-concurrency.sh')

  it('shares the gate, the COALESCE precedence, the pair-narrowed sold predicate and the LEFT JOIN with the three services', () => {
    for (const p of [proof, cartProof]) {
      expect(p).toContain('NOT EXISTS (SELECT 1 FROM cart_tt WHERE cart_tt.sold + cart_tt.quantity > cart_tt.capacity)')
      expect(p).toContain('COALESCE(inv.capacity, tt.capacity) AS capacity')
      expect(p).toContain('AND (inv.id IS NULL OR oi.event_session_id = $s)')
      expect(p).toMatch(/LEFT JOIN event_ticket_type_session_inventory inv\s*\n\s*ON inv\.ticket_type_id = c\.ticket_type_id AND inv\.event_session_id = \$s AND inv\.organisation_id = 'org-a'/)
    }
  })

  it('locks ticket types in byte order, then pair rows in the same order, then the session — matching buildCartLockStatements', () => {
    for (const p of [proof, cartProof]) {
      expect(p).toMatch(/LC_ALL=C sort/)
      expect(p).toMatch(/FROM event_ticket_types WHERE id = '\$id' AND organisation_id = 'org-a' FOR UPDATE/)
      expect(p).toMatch(/FROM event_ticket_type_session_inventory WHERE ticket_type_id = '\$id' AND event_session_id = '\$sess' AND organisation_id = 'org-a' FOR UPDATE/)
      expect(p).toMatch(/FROM event_sessions WHERE id = '\$sess' AND organisation_id = 'org-a' FOR UPDATE/)
      const lockFn = p.slice(p.indexOf('lock_sql() {'), p.indexOf('sess_lit()'))
      expect(lockFn.indexOf('event_ticket_types')).toBeLessThan(lockFn.indexOf('event_ticket_type_session_inventory'))
      expect(lockFn.indexOf('event_ticket_type_session_inventory')).toBeLessThan(lockFn.indexOf('event_sessions'))
    }
  })

  it('covers the migration proof (M), the no-override baseline (Z) and scenarios A–J with a deadlock mutation proof', () => {
    for (const section of ['=== M:', '=== Z:', '=== A:', '=== B:', '=== C:', '=== D:', '=== E:', '=== F:', '=== G:', '=== H:', '=== I:', '=== J:', '=== J MUTATION PROOF']) {
      expect(proof).toContain(section)
    }
    for (const check of ['cross-organisation pair', 'cross-event pair', 'duplicate (type, session) pair', 'negative capacity', 'rollback in the documented order', 'byte-identical after the migration', 'idempotent']) {
      expect(proof).toContain(check)
    }
  })

  it('applies the migration to a database bootstrapped from every PRE-EXISTING Events migration (the current schema), not a bespoke one', () => {
    expect(proof).toMatch(/bootstrap_with "\$\{BASE_MIGRATIONS\[@\]\}"/)
    expect(proof).toMatch(/cat '\$NEW_MIGRATION' \| psql_exec/)
    for (const f of ['create-events.sql', 'create-events-phase2.sql', 'add-events-ticketing.sql', 'add-events-payments.sql']) {
      expect(proof).toContain(`scripts/${f}`)
    }
  })
})
