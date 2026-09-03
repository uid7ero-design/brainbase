import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  computeClassificationEligibility,
  detectEventsNotesMarker,
} from '@/lib/crm/eventContactClassificationBackfill'

// Historical CRM contact classification — PREVIEW ONLY in this phase.
// Mirrors tests/containment/crmEventBackfill.test.ts's own established
// mock/auth pattern for the sibling /api/crm/events-backfill route
// family, rather than inventing a new one. Covers: (1) the pure
// eligibility/notes-marker functions directly, independent of any SQL;
// (2) the preview query's organisation scoping and zero-write
// guarantee via a mocked sql client; (3) the route's auth/capability
// gate; (4) static proofs that no execution/POST path exists anywhere
// yet, and that registration answers are never referenced; (5) the UI
// exposes only a Preview action, never Execute.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ─────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS — no SQL, no mocks
// ─────────────────────────────────────────────────────────────────────

describe('detectEventsNotesMarker', () => {
  it('matches "Events / Event Booking" at the start of notes', () => {
    expect(detectEventsNotesMarker('Events / Event Booking')).toBe('Events / Event Booking')
    expect(detectEventsNotesMarker('Events / Event Booking — some extra text')).toBe('Events / Event Booking')
  })

  it('matches "Events / Historical Backfill" at the start of notes', () => {
    expect(detectEventsNotesMarker('Events / Historical Backfill')).toBe('Events / Historical Backfill')
  })

  it('returns null for notes not starting with either marker, even if the text appears elsewhere', () => {
    expect(detectEventsNotesMarker('Called about renewal. Events / Event Booking mentioned in passing.')).toBeNull()
    expect(detectEventsNotesMarker('Unrelated note')).toBeNull()
  })

  it('returns null for null/empty notes', () => {
    expect(detectEventsNotesMarker(null)).toBeNull()
    expect(detectEventsNotesMarker('')).toBeNull()
  })
})

describe('computeClassificationEligibility — the exact three-tier priority', () => {
  it('NULL classification + valid notes marker + at least one live order link => eligible', () => {
    const result = computeClassificationEligibility({
      currentClassification: null,
      notesMarker: 'Events / Event Booking',
      linkedEventOrderCount: 1,
    })
    expect(result).toEqual({ eligible: true, skipReason: null })
  })

  it('CLIENT => ineligible, "already classified" wins over any other evidence, even strong evidence', () => {
    const result = computeClassificationEligibility({
      currentClassification: 'CLIENT',
      notesMarker: 'Events / Event Booking',
      linkedEventOrderCount: 3,
    })
    expect(result).toEqual({ eligible: false, skipReason: 'already classified (CLIENT)' })
  })

  it('LEAD => ineligible, same as CLIENT', () => {
    const result = computeClassificationEligibility({
      currentClassification: 'LEAD',
      notesMarker: 'Events / Event Booking',
      linkedEventOrderCount: 1,
    })
    expect(result).toEqual({ eligible: false, skipReason: 'already classified (LEAD)' })
  })

  it('an unrelated NULL contact (no marker, no order link) => ineligible, "no Events notes marker" (checked before the order-link tier)', () => {
    const result = computeClassificationEligibility({
      currentClassification: null,
      notesMarker: null,
      linkedEventOrderCount: 0,
    })
    expect(result).toEqual({ eligible: false, skipReason: 'no Events notes marker' })
  })

  it('notes marker present but zero live order links => ineligible ("no linked event order found") — covers both "never linked" and "was linked, order/event since deleted"', () => {
    const result = computeClassificationEligibility({
      currentClassification: null,
      notesMarker: 'Events / Historical Backfill',
      linkedEventOrderCount: 0,
    })
    expect(result).toEqual({ eligible: false, skipReason: 'no linked event order found' })
  })

  it('live order link present but no notes marker => ineligible ("no Events notes marker") — a matched/reused contact, or one whose notes were edited away', () => {
    const result = computeClassificationEligibility({
      currentClassification: null,
      notesMarker: null,
      linkedEventOrderCount: 2,
    })
    expect(result).toEqual({ eligible: false, skipReason: 'no Events notes marker' })
  })

  it('the function accepts no activity-count parameter at all — activity presence/absence structurally cannot affect eligibility', () => {
    // TypeScript already enforces this at the call site (no such field
    // exists on the input type); this test documents and locks that
    // shape so a future edit cannot silently add and start trusting it.
    const source = read('lib/crm/eventContactClassificationBackfill.ts')
    const fnStart = source.indexOf('export function computeClassificationEligibility')
    const fnSignatureEnd = source.indexOf('{', fnStart)
    const signature = source.slice(fnStart, fnSignatureEnd)
    expect(signature).not.toMatch(/activity/i)
  })
})

// ─────────────────────────────────────────────────────────────────────
// PREVIEW QUERY — mocked sql, organisation scoping + zero writes
// ─────────────────────────────────────────────────────────────────────

let calls: { text: string; values: unknown[] }[] = []
let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values })
  return Promise.resolve(responseQueue[callCount++] ?? [])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...(args as [TemplateStringsArray, ...unknown[]])),
}))

const checkCapabilityMock = vi.fn()
const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return {
    ...actual,
    checkCapability: (...args: unknown[]) => checkCapabilityMock(...args),
    requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
  }
})

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0; calls = [] }
function sessionAs(role: string, organisationId = 'org-a') { return { userId: 'staff-1', organisationId, role, name: 'Staff One' } }

const { previewEventContactClassification } = await import('@/lib/crm/eventContactClassificationBackfill')
const route = await import('@/app/api/crm/events-backfill/classification/route')

beforeEach(() => {
  sqlMock.mockClear()
  checkCapabilityMock.mockReset()
  requireCapabilityMock.mockReset()
  requireSessionMock.mockReset()
  queue()
  checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'crm', config: {} } })
  requireCapabilityMock.mockResolvedValue({ key: 'crm', config: {} })
  requireSessionMock.mockResolvedValue(sessionAs('admin'))
})

describe('previewEventContactClassification — organisation scoping', () => {
  it('every sub-query is scoped by organisationId — the linked-order count, the activity count, and the outer candidate WHERE clause', async () => {
    queue([{
      id: 'contact-1', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.invalid',
      notes: 'Events / Event Booking', classification: null,
      linked_order_count: 1, event_activity_count: 1,
    }])
    await previewEventContactClassification('org-a')
    expect(calls).toHaveLength(1)
    const values = calls[0].values
    // organisationId is interpolated three times (linked-order subquery,
    // activity subquery, outer WHERE + its EXISTS clause) — every
    // occurrence must be the same tenant, never a different one.
    const orgOccurrences = values.filter(v => v === 'org-a')
    expect(orgOccurrences.length).toBeGreaterThanOrEqual(3)
    expect(values).not.toContain('org-b')
  })

  it('a different organisationId produces a query scoped to that org only — cross-tenant leakage is impossible by construction (the query has no OR/global branch)', async () => {
    queue([])
    await previewEventContactClassification('org-b')
    expect(calls[0].values.every(v => v !== 'org-a')).toBe(true)
    expect(calls[0].values).toContain('org-b')
  })

  it('returns crmEnabled: false and issues zero SQL calls when the crm capability is disabled', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false, entitlement: null })
    const result = await previewEventContactClassification('org-a')
    expect(result).toEqual({ crmEnabled: false, totalCandidates: 0, eligibleCount: 0, rows: [] })
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('previewEventContactClassification — zero writes', () => {
  it('issues exactly one SQL statement, and it is a SELECT — no UPDATE/INSERT/DELETE anywhere', async () => {
    queue([])
    await previewEventContactClassification('org-a')
    expect(calls).toHaveLength(1)
    expect(calls[0].text.trim().toUpperCase().startsWith('SELECT')).toBe(true)
    expect(calls[0].text).not.toMatch(/UPDATE|INSERT|DELETE/i)
  })

  it('activity absence (event_activity_count = 0) does not block an otherwise-eligible row', async () => {
    queue([{
      id: 'contact-2', first_name: 'Alex', last_name: 'Roe', email: 'alex@example.invalid',
      notes: 'Events / Historical Backfill', classification: null,
      linked_order_count: 1, event_activity_count: 0,
    }])
    const result = await previewEventContactClassification('org-a')
    expect(result.rows[0].eligible).toBe(true)
    expect(result.rows[0].eventActivityCount).toBe(0)
  })

  it('maps a full row correctly end to end', async () => {
    queue([{
      id: 'contact-3', first_name: 'Sam', last_name: 'Lee', email: null,
      notes: 'Events / Event Booking', classification: null,
      linked_order_count: 2, event_activity_count: 1,
    }])
    const result = await previewEventContactClassification('org-a')
    expect(result).toEqual({
      crmEnabled: true,
      totalCandidates: 1,
      eligibleCount: 1,
      rows: [{
        contactId: 'contact-3', name: 'Sam Lee', email: null,
        currentClassification: null, notesMarker: 'Events / Event Booking',
        linkedEventOrderCount: 2, eventActivityCount: 1,
        eligible: true, skipReason: null,
      }],
    })
  })
})

// ─────────────────────────────────────────────────────────────────────
// ROUTE — auth/capability gate
// ─────────────────────────────────────────────────────────────────────

describe('GET /api/crm/events-backfill/classification — authorization', () => {
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

  it('viewer -> 403, no DB call', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await route.GET()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
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

  it('admin+ with both capabilities succeeds and returns the preview body', async () => {
    queue([])
    const res = await route.GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.crmEnabled).toBe(true)
  })

  it('super_admin also passes the role check (role hierarchy)', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('super_admin'))
    queue([])
    const res = await route.GET()
    expect(res.status).toBe(200)
  })

  it('organisation_id used for the preview comes only from the session, never from any request input — the route function takes no request/query parameter at all', async () => {
    const src = read('app/api/crm/events-backfill/classification/route.ts')
    expect(src).toMatch(/export async function GET\(\)/)
    expect(src).not.toMatch(/req\.|request\.|searchParams|nextUrl/)
    expect(src).toContain('auth.session.organisationId')
  })
})

// ─────────────────────────────────────────────────────────────────────
// STATIC — no execution path exists yet, no registration-answer access
// ─────────────────────────────────────────────────────────────────────

describe('No execution/POST path exists in this phase', () => {
  it('the route file exports GET only — no POST', () => {
    const src = read('app/api/crm/events-backfill/classification/route.ts')
    expect(src).toMatch(/export async function GET/)
    expect(src).not.toMatch(/export async function POST/)
  })

  it('the library module has no exported execute/mutate function and no UPDATE/INSERT/DELETE anywhere', () => {
    const src = read('lib/crm/eventContactClassificationBackfill.ts')
    expect(src).not.toMatch(/export (async )?function execute/i)
    expect(src).not.toMatch(/UPDATE\s+crm_contacts|INSERT\s+INTO\s+crm_contacts|DELETE\s+FROM\s+crm_contacts/i)
  })
})

describe('Registration answers are never referenced', () => {
  it('neither the library module nor the route references event_registration_responses/questions or any attendee-answer field in live code (both files\' own comments legitimately NAME these tables while documenting their absence, so comments are stripped before checking for a live reference)', () => {
    for (const file of [
      'lib/crm/eventContactClassificationBackfill.ts',
      'app/api/crm/events-backfill/classification/route.ts',
    ]) {
      const src = stripComments(read(file))
      expect(src).not.toMatch(/event_registration_responses|event_registration_questions|dietary|accessibility/i)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// UI — Preview only, no Execute
// ─────────────────────────────────────────────────────────────────────

describe('app/crm/events-backfill/page.tsx — classification section is preview-only', () => {
  const pageSrc = read('app/crm/events-backfill/page.tsx')

  it('adds the "Classify existing Events contacts" section with a Preview action', () => {
    expect(pageSrc).toContain('Classify existing Events contacts')
    expect(pageSrc).toContain('runClassificationPreview')
    expect(pageSrc).toContain("fetch('/api/crm/events-backfill/classification')")
  })

  it('states plainly that the preview makes no changes', () => {
    expect(pageSrc).toMatch(/This preview makes no changes\./)
  })

  it('contains no Execute action, no confirm() dialog, and no POST call anywhere in the classification section', () => {
    const sectionStart = pageSrc.indexOf('Classify existing Events contacts')
    const sectionEnd = pageSrc.indexOf('function SummaryGrid')
    const section = pageSrc.slice(sectionStart, sectionEnd)
    expect(section).not.toMatch(/runClassificationExecute|classificationExecut/i)
    expect(section).not.toContain('confirm(')
    expect(section).not.toMatch(/method:\s*'POST'/)
  })

  it('renders the requested columns: Contact, Email, Current classification, Events evidence, Linked orders, Activities, Status', () => {
    for (const column of ['Contact', 'Email', 'Current classification', 'Events evidence', 'Linked orders', 'Activities', 'Status']) {
      expect(pageSrc).toContain(column)
    }
  })
})
