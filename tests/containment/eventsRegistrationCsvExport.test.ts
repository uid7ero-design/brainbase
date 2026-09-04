import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Events registration operations phase — CSV export
// (GET /api/events/[id]/orders/export). Route-level tests mock every
// dependency (no real database); real-Postgres proof of the ATTENDEE-
// grain query and the checkin-filter "selects the order_item, not the
// individual attendee row" semantics lives in scripts/tests/
// verify-events-registration-search-filter.sh, not duplicated here.
// What THIS file proves: manager+ auth gating (stricter than the
// viewer+ list route), the privacy exclusion list, real CSV escaping/
// UTF-8/BOM/CRLF (via the REAL lib/events/csvExport.ts, not mocked),
// and that no includeAnswers affordance exists anywhere in this phase.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const sqlMock = vi.fn<(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>>()
sqlMock.mockResolvedValue([])
vi.mock('@/lib/db', () => ({ default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args) }))

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: (...args: unknown[]) => requireCapabilityMock(...args) }
})

function sessionAs(role: string, organisationId = 'org-a') {
  return { userId: 'staff-1', organisationId, role, name: 'Staff One' }
}
function textMatchMock(rules: { match: string; rows: unknown[] }[]) {
  sqlMock.mockImplementation((strings: TemplateStringsArray) => {
    const text = strings.join('?')
    for (const rule of rules) {
      if (text.includes(rule.match)) return Promise.resolve(rule.rows)
    }
    return Promise.resolve([])
  })
}

const exportRoute = await import('@/app/api/events/[id]/orders/export/route')
const { csvEscapeField, buildCsvRow, buildCsv } = await import('@/lib/events/csvExport')

const CTX = { params: Promise.resolve({ id: 'event-1' }) }
function getReq(qs = '') {
  return new Request(`http://localhost/api/events/event-1/orders/export${qs ? `?${qs}` : ''}`)
}

const EVENT_ROW = [{ id: 'event-1', name: 'Test Event' }]

const FULL_ATTENDEE_ROW = {
  order_reference: 'order-1',
  purchaser_name: 'Jane Doe',
  purchaser_email: 'jane@example.invalid',
  purchaser_phone: '0412 345 678',
  payment_status: 'PAID',
  total_cents: 5000,
  currency: 'AUD',
  ticket_type_name: 'General Admission',
  attendee_name: 'Alice Smith',
  session_name: 'Morning Session',
  checked_in_at: '2026-01-01T09:00:00.000Z',
  order_status: 'CONFIRMED',
  created_at: '2025-12-01T00:00:00.000Z',
};

beforeEach(() => {
  sqlMock.mockReset()
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  sqlMock.mockImplementation(() => Promise.resolve([]))
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
  requireCapabilityMock.mockResolvedValue({ key: 'events', config: {} })
})

// ─────────────────────────────────────────────────────────────────────
// lib/events/csvExport.ts — real CSV mechanics, no mocking
// ─────────────────────────────────────────────────────────────────────

describe('csvEscapeField', () => {
  it('leaves a plain field unquoted', () => {
    expect(csvEscapeField('Alice Smith')).toBe('Alice Smith')
  })

  it('quotes a field containing a comma', () => {
    expect(csvEscapeField('Smith, Alice')).toBe('"Smith, Alice"')
  })

  it('quotes a field containing a double quote and doubles the embedded quote', () => {
    expect(csvEscapeField('She said "hi"')).toBe('"She said ""hi"""')
  })

  it('quotes a field containing an embedded newline (LF and CRLF)', () => {
    expect(csvEscapeField('line1\nline2')).toBe('"line1\nline2"')
    expect(csvEscapeField('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('non-ASCII / UTF-8 text is preserved unescaped when it needs no quoting', () => {
    expect(csvEscapeField('José García 田中')).toBe('José García 田中')
  })
})

describe('buildCsv', () => {
  it('starts with a UTF-8 BOM (U+FEFF)', () => {
    const csv = buildCsv(['A'], [['x']])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('uses CRLF line endings throughout, including a trailing CRLF', () => {
    const csv = buildCsv(['A', 'B'], [['1', '2'], ['3', '4']])
    const withoutBom = csv.slice(1)
    expect(withoutBom).toBe('A,B\r\n1,2\r\n3,4\r\n')
  })

  it('null/undefined cells render as empty strings, never the literal "null"/"undefined"', () => {
    const row = buildCsvRow(['x', null, undefined, 'y'])
    expect(row).toBe('x,,,y')
  })
})

// ─────────────────────────────────────────────────────────────────────
// GET /api/events/[id]/orders/export — auth (manager+, stricter than list)
// ─────────────────────────────────────────────────────────────────────

describe('GET /api/events/[id]/orders/export — auth (manager+)', () => {
  it('unauthenticated -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await exportRoute.GET(getReq(), CTX)
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer -> 403 (export is manager+, stricter than the viewer+ list route)', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await exportRoute.GET(getReq(), CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('manager -> allowed', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('manager'))
    textMatchMock([{ match: 'FROM events', rows: EVENT_ROW }])
    const res = await exportRoute.GET(getReq(), CTX)
    expect(res.status).toBe(200)
  })

  it('admin / super_admin also pass (role hierarchy above manager)', async () => {
    for (const role of ['admin', 'super_admin']) {
      requireSessionMock.mockResolvedValue(sessionAs(role))
      textMatchMock([{ match: 'FROM events', rows: EVENT_ROW }])
      const res = await exportRoute.GET(getReq(), CTX)
      expect(res.status).toBe(200)
    }
  })

  it('missing events capability -> 403, no DB call', async () => {
    requireCapabilityMock.mockRejectedValue(new Error('Forbidden'))
    const res = await exportRoute.GET(getReq(), CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('the route source declares authorizeEventsRequest(\'manager\') exactly, not \'viewer\'', () => {
    const src = read('app/api/events/[id]/orders/export/route.ts')
    expect(src).toMatch(/authorizeEventsRequest\('manager'\)/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Shared filter reuse — never a second, hand-copied implementation
// ─────────────────────────────────────────────────────────────────────

describe('the export route reuses the SAME shared filter module as the list route', () => {
  const src = stripComments(read('app/api/events/[id]/orders/export/route.ts'))

  it('imports parseRegistrationFilters and buildRegistrationFilterSql from lib/events/registrationFilters', () => {
    expect(src).toContain("from '@/lib/events/registrationFilters'")
    expect(src).toContain('parseRegistrationFilters(searchParams)')
    expect(src).toContain('buildRegistrationFilterSql(filters, session.organisationId)')
  })

  it('does not redefine paymentStatus/checkin/cancelled/ticketTypeId/sessionId parsing logic locally', () => {
    expect(src).not.toMatch(/searchParams\.get\('paymentStatus'\)/)
    expect(src).not.toMatch(/searchParams\.get\('checkin'\)/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// CSV grain + content
// ─────────────────────────────────────────────────────────────────────

describe('CSV export — attendee grain and content', () => {
  it('one row per attendee — two attendees on the same order_item produce two CSV rows', async () => {
    textMatchMock([
      { match: 'FROM events', rows: EVENT_ROW },
      {
        match: 'FROM event_attendees',
        rows: [
          { ...FULL_ATTENDEE_ROW, attendee_name: 'Alice Smith', checked_in_at: '2026-01-01T09:00:00.000Z' },
          { ...FULL_ATTENDEE_ROW, attendee_name: 'Bob Jones', checked_in_at: null },
        ],
      },
    ])
    const res = await exportRoute.GET(getReq(), CTX)
    const csv = await res.text()
    expect(csv).toContain('Alice Smith')
    expect(csv).toContain('Bob Jones')
    const dataLines = csv.replace(/^﻿/, '').trim().split('\r\n').slice(1)
    expect(dataLines).toHaveLength(2)
  })

  it('Checked in / Check-in timestamp columns reflect each attendee\'s own checked_in_at', async () => {
    textMatchMock([
      { match: 'FROM events', rows: EVENT_ROW },
      { match: 'FROM event_attendees', rows: [{ ...FULL_ATTENDEE_ROW, checked_in_at: null }] },
    ])
    const res = await exportRoute.GET(getReq(), CTX)
    const csv = await res.text()
    expect(csv).toContain(',No,,') // Checked in=No, Check-in timestamp=empty
  })

  it('Cancelled column reflects order_status = CANCELLED', async () => {
    textMatchMock([
      { match: 'FROM events', rows: EVENT_ROW },
      { match: 'FROM event_attendees', rows: [{ ...FULL_ATTENDEE_ROW, order_status: 'CANCELLED' }] },
    ])
    const res = await exportRoute.GET(getReq(), CTX)
    const csv = await res.text()
    const line = csv.split('\r\n')[1]
    expect(line).toMatch(/,Yes,[^,]*$/) // Cancelled=Yes is the second-to-last column
  })

  it('a REFUNDED order still produces a row with its real payment status — export does not silently drop refunded orders', async () => {
    textMatchMock([
      { match: 'FROM events', rows: EVENT_ROW },
      { match: 'FROM event_attendees', rows: [{ ...FULL_ATTENDEE_ROW, payment_status: 'REFUNDED' }] },
    ])
    const res = await exportRoute.GET(getReq(), CTX)
    const csv = await res.text()
    expect(csv).toContain('REFUNDED')
  })

  it('order total is a spreadsheet-friendly decimal (cents / 100), currency in its own separate column', async () => {
    textMatchMock([
      { match: 'FROM events', rows: EVENT_ROW },
      { match: 'FROM event_attendees', rows: [{ ...FULL_ATTENDEE_ROW, total_cents: 12345, currency: 'AUD' }] },
    ])
    const res = await exportRoute.GET(getReq(), CTX)
    const csv = await res.text()
    expect(csv).toContain('123.45')
    expect(csv).toContain('AUD')
  })

  it('response headers: text/csv content type and an attachment Content-Disposition', async () => {
    textMatchMock([{ match: 'FROM events', rows: EVENT_ROW }])
    const res = await exportRoute.GET(getReq(), CTX)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Privacy exclusions
// ─────────────────────────────────────────────────────────────────────

describe('CSV export — privacy exclusions', () => {
  it('the SELECT list never references internal notes, tokens, QR, Stripe identifiers, crm_contact_id, or checked_in_by_user_id', () => {
    const src = stripComments(read('app/api/events/[id]/orders/export/route.ts'))
    for (const forbidden of [
      'event_order_notes',
      'ticket_token',
      'qr',
      'stripe_checkout_session_id',
      'stripe_payment_intent_id',
      'stripe_account_id',
      'crm_contact_id',
      'checked_in_by_user_id',
      'event_registration_responses',
    ]) {
      expect(src.toLowerCase(), `must not reference ${forbidden}`).not.toContain(forbidden.toLowerCase())
    }
  })

  it('no includeAnswers parameter exists anywhere in this route\'s live code — the answers opt-in is explicitly a separate, not-yet-implemented fast-follow; the route\'s own header comment legitimately NAMES the parameter while documenting its absence, so comments are stripped before checking for a live reference', () => {
    const src = stripComments(read('app/api/events/[id]/orders/export/route.ts'))
    expect(src).not.toContain('includeAnswers')
  })

  it('even if a client supplies includeAnswers, it has no effect — the shared filter module RegistrationFilters type has no such field for anything to trust', () => {
    const src = read('lib/events/registrationFilters.ts')
    expect(src).not.toContain('includeAnswers')
  })

  it('the CSV header names exactly the 14 approved columns, in the specified order', async () => {
    textMatchMock([{ match: 'FROM events', rows: EVENT_ROW }])
    const res = await exportRoute.GET(getReq(), CTX)
    const csv = await res.text()
    const header = csv.replace(/^﻿/, '').split('\r\n')[0]
    expect(header).toBe([
      'Order reference', 'Purchaser name', 'Purchaser email', 'Purchaser phone',
      'Payment status', 'Order total', 'Currency', 'Ticket type', 'Attendee name',
      'Session', 'Checked in', 'Check-in timestamp', 'Cancelled', 'Created',
    ].join(','))
  })
})

// ─────────────────────────────────────────────────────────────────────
// Tenancy
// ─────────────────────────────────────────────────────────────────────

describe('GET /api/events/[id]/orders/export — tenancy', () => {
  it('organisation_id is derived only from the session, never a query param/body', () => {
    const src = stripComments(read('app/api/events/[id]/orders/export/route.ts'))
    expect(src).toContain('session.organisationId')
    expect(src).not.toMatch(/organisationId:\s*req\.|searchParams\.get\('organisationId'\)/)
  })

  it('event not belonging to the caller\'s organisation -> 404, no attendee query', async () => {
    textMatchMock([{ match: 'FROM events', rows: [] }])
    const res = await exportRoute.GET(getReq(), CTX)
    expect(res.status).toBe(404)
  })
})
