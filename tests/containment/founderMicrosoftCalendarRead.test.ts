import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Founder OS Phase E.5B.1 — read-only Microsoft Calendar query.
//
// The first real consumer of E.5A's getValidAccessToken() (previously
// implemented but never called by any route). GET only, bounded to a
// single day, using only the already-approved Calendars.Read scope via
// GET /v1.0/me/calendarView. Deliberately does NOT implement calendar
// write, mail, Bookings, contacts, files/OneDrive, or Teams — this
// suite proves both the positive behaviour and the absence of all of
// those, at the source level (no such handler/endpoint reference exists
// at all) and functionally (mocked Graph responses never leak tokens/
// raw data through the route).

const requireGlobalIntegrationAccessMock = vi.fn()
const integrationAccessErrorStatusMock = vi.fn((err: unknown) => (err as { status?: number })?.status ?? 401)
vi.mock('@/lib/globalIntegrationAccess', () => ({
  requireGlobalIntegrationAccess: (...args: unknown[]) => requireGlobalIntegrationAccessMock(...args),
  integrationAccessErrorStatus: (err: unknown) => integrationAccessErrorStatusMock(err),
}))

const getValidAccessTokenMock = vi.fn()
const getConnectionSummaryMock = vi.fn()
vi.mock('@/lib/microsoft/tokens', () => ({
  getValidAccessToken: (...args: unknown[]) => getValidAccessTokenMock(...args),
  getConnectionSummary: (...args: unknown[]) => getConnectionSummaryMock(...args),
}))

const fetchMock = vi.fn()
const originalFetch = global.fetch

const { GET } = await import('@/app/api/integrations/microsoft/events/route')

const ROUTE_PATH = path.resolve(__dirname, '../../app/api/integrations/microsoft/events/route.ts')
const ROUTE_SOURCE = fs.readFileSync(ROUTE_PATH, 'utf-8')

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
const ROUTE_EXECUTABLE = stripComments(ROUTE_SOURCE)

const AUTHORIZED = { userId: 'u1', organisationId: 'org-brainbase', role: 'super_admin', name: 'James' }

const SAMPLE_GRAPH_EVENT = {
  id: 'AAMkAGI-event-1',
  subject: 'Board sync',
  start: { dateTime: '2026-08-24T09:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-08-24T09:30:00.0000000', timeZone: 'UTC' },
  location: { displayName: 'Teams meeting' },
  isAllDay: false,
  // Fields the route must never surface, present here specifically to
  // prove they get dropped by the mapping, not merely "never requested":
  attendees: [{ emailAddress: { address: 'someone@brainbase.example', name: 'Someone' } }],
  organizer: { emailAddress: { address: 'organizer@brainbase.example', name: 'Organizer' } },
  body: { contentType: 'html', content: '<p>Sensitive agenda details</p>' },
  bodyPreview: 'Sensitive agenda preview',
  onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/secret' },
}

beforeEach(() => {
  requireGlobalIntegrationAccessMock.mockReset()
  integrationAccessErrorStatusMock.mockClear()
  getValidAccessTokenMock.mockReset()
  getConnectionSummaryMock.mockReset()
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  global.fetch = originalFetch
})

// ── 1-4. ACCESS CONTROL ──────────────────────────────────────────────────

describe('Access control (tests 1-4)', () => {
  it('test 1/2: GET requires authorised BrainBase access — an unauthenticated request fails before any Graph/token work', async () => {
    requireGlobalIntegrationAccessMock.mockRejectedValue({ status: 401 })
    const res = await GET()
    expect(res.status).toBe(401)
    expect(getValidAccessTokenMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('test 3: an insufficient role fails before any Graph/token work', async () => {
    requireGlobalIntegrationAccessMock.mockRejectedValue({ status: 403 })
    const res = await GET()
    expect(res.status).toBe(403)
    expect(getValidAccessTokenMock).not.toHaveBeenCalled()
    expect(getConnectionSummaryMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('test 4: a viewer-or-higher session can reach the route (access check passes through)', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue(null)
    const res = await GET()
    expect(requireGlobalIntegrationAccessMock).toHaveBeenCalledWith('MS365_OWNER_ORG_ID', 'viewer')
    expect(res.status).toBe(401) // reaches the "not connected" branch, not a 403
  })
})

// ── 5/6. TOKEN INTEGRATION ───────────────────────────────────────────────

describe('Token integration (tests 5, 6)', () => {
  it('test 5: getValidAccessToken() is used rather than duplicated token/refresh logic', () => {
    expect(ROUTE_EXECUTABLE).toContain("import { getValidAccessToken, getConnectionSummary } from '@/lib/microsoft/tokens';")
    expect(ROUTE_EXECUTABLE).not.toMatch(/refresh_token|grant_type/i)
  })

  it('test 6: no connection/token returns HTTP 401 "Not connected"', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json).toEqual({ error: 'Not connected' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ── 7-12. GRAPH REQUEST SHAPE ────────────────────────────────────────────

describe('Graph request shape (tests 7-12)', () => {
  it('test 7: Graph request uses /v1.0/me/calendarView', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue('access-token-value')
    getConnectionSummaryMock.mockResolvedValue({ accountEmail: 'james@brainbase.example' })
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ value: [] }) })
    await GET()
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url.startsWith('https://graph.microsoft.com/v1.0/me/calendarView?')).toBe(true)
  })

  it('test 8/9: query contains bounded startDateTime and endDateTime', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue('access-token-value')
    getConnectionSummaryMock.mockResolvedValue({ accountEmail: 'james@brainbase.example' })
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ value: [] }) })
    await GET()
    const [url] = fetchMock.mock.calls[0] as [string]
    const params = new URL(url).searchParams
    const startDateTime = params.get('startDateTime')
    const endDateTime = params.get('endDateTime')
    expect(startDateTime).toBeTruthy()
    expect(endDateTime).toBeTruthy()
    expect(new Date(startDateTime!).getTime()).toBeLessThan(new Date(endDateTime!).getTime())
    // Bounded to a single day, not an unbounded/all-time query.
    const spanMs = new Date(endDateTime!).getTime() - new Date(startDateTime!).getTime()
    expect(spanMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
  })

  it('test 10: only Calendars.Read-compatible read behaviour is used — no write/create call exists anywhere', () => {
    expect(ROUTE_EXECUTABLE).not.toMatch(/method:\s*['"]POST['"]|method:\s*['"]PUT['"]|method:\s*['"]PATCH['"]|method:\s*['"]DELETE['"]/)
    expect(ROUTE_EXECUTABLE).not.toContain('Calendars.ReadWrite')
  })

  it('test 11: the bearer token is sent to Graph but never returned in the response', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue('super-secret-access-token')
    getConnectionSummaryMock.mockResolvedValue({ accountEmail: 'james@brainbase.example' })
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ value: [SAMPLE_GRAPH_EVENT] }) })
    const res = await GET()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer super-secret-access-token')
    const json = await res.json()
    expect(JSON.stringify(json)).not.toContain('super-secret-access-token')
  })

  it('test 12: Prefer: outlook.timezone="UTC" is sent', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue('access-token-value')
    getConnectionSummaryMock.mockResolvedValue({ accountEmail: 'james@brainbase.example' })
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ value: [] }) })
    await GET()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Prefer).toBe('outlook.timezone="UTC"')
  })

  it('the Graph request uses $select to request only the minimum fields, and a bounded 8s timeout matching the established BrainBase convention', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue('access-token-value')
    getConnectionSummaryMock.mockResolvedValue({ accountEmail: 'james@brainbase.example' })
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ value: [] }) })
    await GET()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const select = new URL(url).searchParams.get('$select')
    expect(select).toBe('id,subject,start,end,location,isAllDay')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

// ── 13-19. NORMALIZED RESPONSE / NO RAW DATA ─────────────────────────────

describe('Normalized response shape — no raw Graph data ever passed through (tests 13-19)', () => {
  it('test 13/14: the Graph response is normalized, not passed through raw', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue('access-token-value')
    getConnectionSummaryMock.mockResolvedValue({ accountEmail: 'james@brainbase.example' })
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ value: [SAMPLE_GRAPH_EVENT] }) })
    const res = await GET()
    const json = await res.json()
    expect(json).toEqual({
      events: [{
        id: 'AAMkAGI-event-1',
        title: 'Board sync',
        allDay: false,
        start: '2026-08-24T09:00:00.0000000',
        end: '2026-08-24T09:30:00.0000000',
        location: 'Teams meeting',
        account: 'james@brainbase.example',
      }],
    })
  })

  it('test 15: attendees are not returned', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue('access-token-value')
    getConnectionSummaryMock.mockResolvedValue({ accountEmail: 'james@brainbase.example' })
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ value: [SAMPLE_GRAPH_EVENT] }) })
    const res = await GET()
    const json = await res.json()
    expect(JSON.stringify(json)).not.toMatch(/attendee/i)
    expect(JSON.stringify(json)).not.toContain('someone@brainbase.example')
  })

  it('test 16: organizer data is not returned', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue('access-token-value')
    getConnectionSummaryMock.mockResolvedValue({ accountEmail: 'james@brainbase.example' })
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ value: [SAMPLE_GRAPH_EVENT] }) })
    const res = await GET()
    const json = await res.json()
    expect(JSON.stringify(json)).not.toMatch(/organizer/i)
    expect(JSON.stringify(json)).not.toContain('organizer@brainbase.example')
  })

  it('test 17: body/bodyPreview is not returned', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue('access-token-value')
    getConnectionSummaryMock.mockResolvedValue({ accountEmail: 'james@brainbase.example' })
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ value: [SAMPLE_GRAPH_EVENT] }) })
    const res = await GET()
    const json = await res.json()
    expect(JSON.stringify(json)).not.toContain('Sensitive agenda')
    expect(JSON.stringify(json)).not.toMatch(/bodyPreview|"body"/i)
  })

  it('never returns onlineMeeting/extensions/recurrence internals either', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue('access-token-value')
    getConnectionSummaryMock.mockResolvedValue({ accountEmail: 'james@brainbase.example' })
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ value: [SAMPLE_GRAPH_EVENT] }) })
    const res = await GET()
    const json = await res.json()
    expect(JSON.stringify(json)).not.toMatch(/onlineMeeting|teams\.microsoft\.com/i)
  })

  it('test 18: tokens/secrets are not returned in a successful response', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue('super-secret-access-token')
    getConnectionSummaryMock.mockResolvedValue({ accountEmail: 'james@brainbase.example' })
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ value: [SAMPLE_GRAPH_EVENT] }) })
    const res = await GET()
    const json = await res.json()
    expect(JSON.stringify(json)).not.toMatch(/token|secret/i)
  })

  it('test 19: a Graph error body is not returned to the client', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue('access-token-value')
    getConnectionSummaryMock.mockResolvedValue({ accountEmail: 'james@brainbase.example' })
    fetchMock.mockResolvedValue({
      ok: false, status: 401,
      json: () => Promise.resolve({ error: { code: 'InvalidAuthenticationToken', message: 'SENSITIVE_GRAPH_DETAIL' } }),
    })
    const res = await GET()
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(JSON.stringify(json)).not.toContain('SENSITIVE_GRAPH_DETAIL')
    expect(JSON.stringify(json)).not.toContain('InvalidAuthenticationToken')
  })
})

// ── 20. LOGGING ──────────────────────────────────────────────────────────

describe('Logging never includes Graph error body, event data, or tokens (test 20)', () => {
  it('no console.* call in the route source interpolates a raw token, secret, or event-data variable', () => {
    const consoleLines = ROUTE_EXECUTABLE.split('\n').filter(l => /console\.(log|warn|error)/.test(l))
    for (const line of consoleLines) {
      expect(line).not.toMatch(/token|secret|subject|attendee|organizer|\bbody\b/i)
    }
  })

  it('functional: a Graph failure logs only a status code, never the response body', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    getValidAccessTokenMock.mockResolvedValue('access-token-value')
    getConnectionSummaryMock.mockResolvedValue({ accountEmail: 'james@brainbase.example' })
    fetchMock.mockResolvedValue({
      ok: false, status: 500,
      json: () => Promise.resolve({ error: { message: 'SENSITIVE_GRAPH_DETAIL' } }),
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await GET()
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('SENSITIVE_GRAPH_DETAIL')
    }
    errorSpy.mockRestore()
  })
})

// ── 21-24. NO WRITE HANDLERS ──────────────────────────────────────────────

describe('No write handlers exist (tests 21-24)', () => {
  it('test 21: there is no POST handler', () => {
    expect(ROUTE_EXECUTABLE).not.toMatch(/export\s+(async\s+)?function\s+POST/)
  })
  it('test 22: there is no PUT handler', () => {
    expect(ROUTE_EXECUTABLE).not.toMatch(/export\s+(async\s+)?function\s+PUT/)
  })
  it('test 23: there is no PATCH handler', () => {
    expect(ROUTE_EXECUTABLE).not.toMatch(/export\s+(async\s+)?function\s+PATCH/)
  })
  it('test 24: there is no DELETE handler', () => {
    expect(ROUTE_EXECUTABLE).not.toMatch(/export\s+(async\s+)?function\s+DELETE/)
  })
})

// ── 25-29. SCOPE CONTAINMENT — NO MAIL/BOOKINGS/CONTACTS/FILES/TEAMS ──────

describe('Scope containment: no mail/Bookings/contacts/files/Teams API is called (tests 25-29)', () => {
  it('test 25: no Microsoft mail API is called', () => {
    expect(ROUTE_EXECUTABLE).not.toMatch(/\/me\/messages|sendMail|\/me\/mailFolders/)
  })
  it('test 26: no Bookings API is called', () => {
    expect(ROUTE_EXECUTABLE).not.toMatch(/bookingBusinesses|BookingsAppointment/)
  })
  it('test 27: no contacts API is called', () => {
    expect(ROUTE_EXECUTABLE).not.toMatch(/\/me\/contacts/)
  })
  it('test 28: no OneDrive/files API is called', () => {
    expect(ROUTE_EXECUTABLE).not.toMatch(/\/me\/drive|OneDrive/i)
  })
  it('test 29: no Teams API is called', () => {
    expect(ROUTE_EXECUTABLE).not.toMatch(/\/teams\b|graph\.microsoft\.com\/v1\.0\/teams/i)
  })
})

// ── 30. NO SCHEMA/DDL ──────────────────────────────────────────────────────

describe('No schema/DDL/migration is introduced (test 30)', () => {
  it('test 30: the route file contains no SQL/DDL of any kind', () => {
    expect(ROUTE_EXECUTABLE).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE FUNCTION|CREATE TRIGGER/i)
    expect(ROUTE_EXECUTABLE).not.toContain('@/lib/db')
  })
})
