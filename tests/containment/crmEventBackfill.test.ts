import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase 6.2 — historical Events -> CRM backfill. Route-level tests
// (mocked sql, no real database) plus source-text data-safety proofs.
// Real-Postgres proof of the match/create/ambiguity/concurrency SQL
// pattern lives in scripts/tests/verify-events-crm-backfill.sh — not
// duplicated here.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

const requireCapabilityMock = vi.fn()
const checkCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return {
    ...actual,
    requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
    checkCapability: (...args: unknown[]) => checkCapabilityMock(...args),
  }
})

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function sessionAs(role: string, organisationId = 'org-a') { return { userId: 'staff-1', organisationId, role, name: 'Staff One' } }

const route = await import('@/app/api/crm/events-backfill/route')

beforeEach(() => {
  sqlMock.mockClear()
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  checkCapabilityMock.mockReset()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(sessionAs('admin'))
  requireCapabilityMock.mockResolvedValue({ key: 'crm', config: {} })
  checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'crm', config: {} } })
})

// ─── Authorization ──────────────────────────────────────────────────

describe('GET /api/crm/events-backfill — authorization', () => {
  it('unauthenticated -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await route.GET()
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('manager (below admin) -> 403, no DB call', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('manager'))
    const res = await route.GET()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer -> 403', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await route.GET()
    expect(res.status).toBe(403)
  })

  it('admin without the events capability -> 403, no DB call', async () => {
    requireCapabilityMock.mockImplementation(async (_org: string, key: string) => {
      if (key === 'events') throw new Error('Forbidden')
      return { key, config: {} }
    })
    const res = await route.GET()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('admin without the crm capability -> 403, no DB call', async () => {
    requireCapabilityMock.mockImplementation(async (_org: string, key: string) => {
      if (key === 'crm') throw new Error('Forbidden')
      return { key, config: {} }
    })
    const res = await route.GET()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('admin+ with both capabilities succeeds', async () => {
    queue([{ count: 0 }], [])
    const res = await route.GET()
    expect(res.status).toBe(200)
  })

  it('super_admin also passes the role check (role hierarchy)', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('super_admin'))
    queue([{ count: 0 }], [])
    const res = await route.GET()
    expect(res.status).toBe(200)
  })
})

describe('POST /api/crm/events-backfill — authorization (same gate as GET)', () => {
  it('unauthenticated -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await route.POST()
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('manager -> 403, no DB call', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('manager'))
    const res = await route.POST()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

// ─── organisation_id is never client-supplied ──────────────────────

describe('organisation_id is derived only from the session, never from the request', () => {
  it('GET takes no arguments at all — there is no request body or query param this route reads for organisation identity', () => {
    const code = stripComments(read('app/api/crm/events-backfill/route.ts'))
    const getFn = code.slice(code.indexOf('export async function GET'), code.indexOf('export async function POST'))
    expect(getFn).not.toMatch(/req\.(json|nextUrl|searchParams)/)
    expect(getFn).toMatch(/auth\.session\.organisationId/)
  })

  it('POST likewise reads no request body', () => {
    const code = stripComments(read('app/api/crm/events-backfill/route.ts'))
    const postFn = code.slice(code.indexOf('export async function POST'))
    expect(postFn).not.toMatch(/req\.(json|nextUrl|searchParams)/)
    expect(postFn).toMatch(/auth\.session\.organisationId/)
  })
})

// ─── Preview is genuinely read-only ────────────────────────────────

describe('Preview (GET) never mutates — zero INSERT/UPDATE/DELETE statements', () => {
  it('the preview code path (previewEventContactBackfill) contains no INSERT, UPDATE, or DELETE statement anywhere', () => {
    const code = stripComments(read('lib/crm/eventBackfill.ts'))
    const previewFn = code.slice(code.indexOf('export async function previewEventContactBackfill'), code.indexOf('export type BackfillOutcome'))
    expect(previewFn).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/i)
  })

  it('a GET request with organisation-scoped unlinked orders classifies them without ever calling an execution-only helper', async () => {
    queue(
      [{ count: 2 }], // alreadyLinkedOrders
      [ // unlinked orders
        { id: 'order-1', purchaser_name: 'Alice', purchaser_email: 'alice@example.invalid', purchaser_phone: null },
        { id: 'order-2', purchaser_name: 'No Identity', purchaser_email: null, purchaser_phone: null },
      ],
      [{ id: 'contact-1' }], // match for order-1 (email match, count=1)
    )
    const res = await route.GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.alreadyLinkedOrders).toBe(2)
    expect(body.totalUnlinkedOrders).toBe(2)
    expect(body.wouldLinkExisting).toBe(1)
    expect(body.skippedInsufficientIdentity).toBe(1)
    // No INSERT/UPDATE ever issued via the mocked sql during a preview.
    const allSqlText = sqlMock.mock.calls.map(c => ((c as unknown as [string[]])[0]).join('')).join('\n')
    expect(allSqlText).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET/i)
  })

  it('an org with CRM disabled returns an empty, non-mutating preview rather than erroring', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false })
    const res = await route.GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.crmEnabled).toBe(false)
    expect(body.rows).toEqual([])
  })
})

// ─── Missing email/phone behavior ──────────────────────────────────

describe('Missing email/phone -> skipped, never auto-created (deliberate divergence from live sync)', () => {
  it('an order with neither email nor phone is classified skipped_insufficient_identity, not would_create_new', async () => {
    queue([{ count: 0 }], [{ id: 'order-1', purchaser_name: 'Ghost', purchaser_email: null, purchaser_phone: null }])
    const res = await route.GET()
    const body = await res.json()
    expect(body.rows[0].classification).toBe('skipped_insufficient_identity')
    expect(body.wouldCreateNew).toBe(0)
  })
})

// ─── Data safety: source-text proof ────────────────────────────────

describe('Data safety — structurally cannot copy registration answers or internal notes', () => {
  const backfillSource = stripComments(read('lib/crm/eventBackfill.ts'))

  it('never references event_registration_responses (dietary/accessibility/special-request answers)', () => {
    expect(backfillSource).not.toMatch(/event_registration_responses/)
  })

  it('never references event_order_notes (internal staff notes)', () => {
    expect(backfillSource).not.toMatch(/event_order_notes/)
  })

  it('never references event_attendees (§3 — purchaser identity only, not attendee identity, for this phase)', () => {
    expect(backfillSource).not.toMatch(/event_attendees/)
  })

  it('only reads purchaser_name/purchaser_email/purchaser_phone off event_orders — no other event_orders column is selected', () => {
    const selectMatch = backfillSource.match(/SELECT id, purchaser_name, purchaser_email, purchaser_phone\s+FROM event_orders/g)
    expect(selectMatch?.length).toBeGreaterThanOrEqual(2) // preview + execute
  })
})

describe('CRM contact data is never blindly overwritten', () => {
  const backfillSource = stripComments(read('lib/crm/eventBackfill.ts'))

  it('this file contains no UPDATE statement against crm_contacts anywhere — a match only ever reuses an existing row\'s id, never rewrites its columns', () => {
    expect(backfillSource).not.toMatch(/UPDATE\s+crm_contacts\s+SET/i)
  })

  it('the only INSERT into crm_contacts is gated on zero existing matches (cnt = 0) — never fires when a match already exists', () => {
    expect(backfillSource).toMatch(/INSERT INTO crm_contacts[\s\S]*?FROM match_count WHERE cnt = 0/)
  })
})

// ─── Ambiguous match is never silently resolved ────────────────────

describe('Ambiguous matches are reported, never silently resolved', () => {
  it('previewEventContactBackfill counts matches with no LIMIT, distinguishing 1 from >1 (unlike eventSync.ts\'s own LIMIT-1 shortcut)', () => {
    const code = stripComments(read('lib/crm/eventBackfill.ts'))
    const previewFn = code.slice(code.indexOf('export async function previewEventContactBackfill'), code.indexOf('export type BackfillOutcome'))
    expect(previewFn).toMatch(/matches\.length === 0/)
    expect(previewFn).toMatch(/matches\.length === 1/)
    expect(previewFn).toMatch(/ambiguous\+\+/)
  })

  it('executeEventContactBackfill skips (never inserts, never links) when match_count > 1', () => {
    const code = stripComments(read('lib/crm/eventBackfill.ts'))
    const execFn = code.slice(code.indexOf('export async function executeEventContactBackfill'))
    expect(execFn).toMatch(/matchCount > 1/)
    expect(execFn).toMatch(/skipped_ambiguous/)
  })
})

// ─── View CRM Contact gating is unchanged (§9) ─────────────────────

describe('§9 — existing "View CRM Contact" gating logic is unchanged; backfilled orders surface it automatically', () => {
  it('RegistrationsPanel.tsx still gates the action purely on crm_contact_id being truthy — no new condition was added for backfilled vs. live-synced orders', () => {
    const panel = read('app/events/[id]/RegistrationsPanel.tsx')
    expect(panel).toMatch(/canManage && crmEnabled && o\.crm_contact_id && \(/)
  })
})
