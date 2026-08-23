import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Founder OS Phase E.5A — Microsoft 365 connection foundation.
//
// Scope: OAuth login/callback/status only, connection-status display in
// Founder OS System. Deliberately does NOT read calendar events, mail,
// contacts, files, or implement Microsoft Bookings — those are explicit
// future phases (E.5B+), not this one. Tokens are stored encrypted in
// Neon (lib/microsoft/tokens.ts), reusing the same, already-proven
// AES-256-GCM encrypt()/decrypt() lib/social/crypto.ts already uses for
// Instagram — a deliberate departure from Gmail/GCal's own plaintext,
// filesystem-based token store, not a copy of it.

const requireGlobalIntegrationAccessMock = vi.fn()
const integrationAccessErrorStatusMock = vi.fn((err: unknown) => (err as { status?: number })?.status ?? 401)
vi.mock('@/lib/globalIntegrationAccess', () => ({
  requireGlobalIntegrationAccess: (...args: unknown[]) => requireGlobalIntegrationAccessMock(...args),
  integrationAccessErrorStatus: (err: unknown) => integrationAccessErrorStatusMock(err),
}))

const createOAuthStateMock = vi.fn()
const verifyOAuthStateMock = vi.fn()
vi.mock('@/lib/oauthState', () => ({
  createOAuthState: (...args: unknown[]) => createOAuthStateMock(...args),
  verifyOAuthState: (...args: unknown[]) => verifyOAuthStateMock(...args),
}))

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
const transactionMock = vi.fn(async (queries: unknown[]) => Promise.all(queries as Promise<unknown>[]))
vi.mock('@/lib/db', () => ({
  default: Object.assign(
    (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
    { transaction: (...args: unknown[]) => (transactionMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args) },
  ),
}))

function sqlCallArgs(index: number): unknown[] {
  return sqlMock.mock.calls[index] as unknown as unknown[]
}

// lib/social/crypto.ts is deliberately NOT mocked — using the real
// AES-256-GCM implementation lets us prove tokens are genuinely
// encrypted (ciphertext != plaintext, round-trips correctly), not just
// assume it.

const fetchMock = vi.fn()
const originalFetch = global.fetch
const ORIGINAL_ENV = { ...process.env }

const { GET: loginGET } = await import('@/app/api/integrations/microsoft/login/route')
const { GET: callbackGET } = await import('@/app/api/integrations/microsoft/callback/route')
const { GET: statusGET, DELETE: statusDELETE } = await import('@/app/api/integrations/microsoft/status/route')
const {
  MS365_SCOPES, writeConnection, readConnection, getConnectionSummary, clearConnection, getValidAccessToken,
} = await import('@/lib/microsoft/tokens')
const { getMicrosoftState } = await import('@/lib/founder/systemSignals')

const LOGIN_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/integrations/microsoft/login/route.ts'), 'utf-8')
const CALLBACK_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/integrations/microsoft/callback/route.ts'), 'utf-8')
const STATUS_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/integrations/microsoft/status/route.ts'), 'utf-8')
const TOKENS_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../lib/microsoft/tokens.ts'), 'utf-8')
const SIGNALS_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../lib/founder/systemSignals.ts'), 'utf-8')
const SYSTEM_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/system/route.ts'), 'utf-8')
const FOUNDER_PAGE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/admin/founder/page.tsx'), 'utf-8')
const GMAIL_LOGIN_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/integrations/gmail/login/route.ts'), 'utf-8')
const GMAIL_TOKENS_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../lib/gmail/tokens.ts'), 'utf-8')
const GCAL_TOKENS_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../lib/gcal/tokens.ts'), 'utf-8')
const SCHEMA_SCRIPT_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../scripts/create-microsoft-connections.sql'), 'utf-8')

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
// SQL uses `--` line comments, not `//` — a separate stripper so
// assertions against the schema script only see real DDL, matching the
// same "scope to executable code, not explanatory prose" discipline
// already used for the .ts files above.
function stripSqlComments(src: string): string {
  return src.replace(/--.*$/gm, '')
}
const CALLBACK_EXECUTABLE = stripComments(CALLBACK_SOURCE)
const TOKENS_EXECUTABLE = stripComments(TOKENS_SOURCE)
const LOGIN_EXECUTABLE = stripComments(LOGIN_SOURCE)
const STATUS_EXECUTABLE = stripComments(STATUS_SOURCE)
const SCHEMA_SCRIPT_EXECUTABLE = stripSqlComments(SCHEMA_SCRIPT_SOURCE)

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

const AUTHORIZED = { userId: 'u1', organisationId: 'org-brainbase', role: 'super_admin', name: 'James' }

beforeEach(() => {
  requireGlobalIntegrationAccessMock.mockReset()
  integrationAccessErrorStatusMock.mockClear()
  createOAuthStateMock.mockReset()
  verifyOAuthStateMock.mockReset()
  sqlMock.mockClear()
  transactionMock.mockClear()
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  responseQueue = []
  callCount = 0
  process.env = { ...ORIGINAL_ENV }
  process.env.MS365_TENANT_ID = 'test-tenant-id'
  process.env.MS365_CLIENT_ID = 'test-client-id'
  process.env.MS365_CLIENT_SECRET = 'test-client-secret'
  process.env.MS365_REDIRECT_URI = 'https://example.test/api/integrations/microsoft/callback'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  global.fetch = originalFetch
})

// ── 1/2. AUTH ────────────────────────────────────────────────────────────

describe('Access control (tests 1, 2)', () => {
  it('test 1: login requires authorized global-integration access', async () => {
    requireGlobalIntegrationAccessMock.mockRejectedValue({ status: 403 })
    const res = await loginGET()
    expect(res.status).toBe(403)
    expect(createOAuthStateMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('test 2: status requires authorized access', async () => {
    requireGlobalIntegrationAccessMock.mockRejectedValue({ status: 401 })
    const res = await statusGET()
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('login uses requireGlobalIntegrationAccess with MS365_OWNER_ORG_ID, matching the established Gmail/GCal env-var-name convention', () => {
    expect(LOGIN_EXECUTABLE).toContain("requireGlobalIntegrationAccess('MS365_OWNER_ORG_ID', 'manager')")
  })

  it('status GET uses viewer minimum, status DELETE uses manager minimum — matching the established Gmail/GCal asymmetry', () => {
    expect(STATUS_EXECUTABLE).toContain("requireGlobalIntegrationAccess('MS365_OWNER_ORG_ID', 'viewer')")
    expect(STATUS_EXECUTABLE).toContain("requireGlobalIntegrationAccess('MS365_OWNER_ORG_ID', 'manager')")
  })
})

// ── 3/4/5/6. OAUTH STATE + ERROR HANDLING ───────────────────────────────

describe('OAuth state / CSRF protection (tests 3, 4, 5, 6)', () => {
  it('test 3: OAuth state is generated via createOAuthState and embedded in the authorize URL', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    createOAuthStateMock.mockResolvedValue('random-state-value')
    const res = await loginGET()
    expect(createOAuthStateMock).toHaveBeenCalledWith('ms365_oauth_state')
    expect(res.status).toBe(307)
    const location = res.headers.get('location')!
    expect(new URL(location).searchParams.get('state')).toBe('random-state-value')
  })

  it('test 4: callback rejects a request with no state param', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    verifyOAuthStateMock.mockResolvedValue(false)
    const req = new Request('https://example.test/api/integrations/microsoft/callback?code=abc')
    const res = await callbackGET(req as never)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('ms_error=invalid_state')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('test 5: callback rejects a mismatched state', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    verifyOAuthStateMock.mockResolvedValue(false)
    const req = new Request('https://example.test/api/integrations/microsoft/callback?code=abc&state=wrong')
    const res = await callbackGET(req as never)
    expect(verifyOAuthStateMock).toHaveBeenCalledWith('ms365_oauth_state', 'wrong')
    expect(res.headers.get('location')).toContain('ms_error=invalid_state')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('test 6: callback rejects an OAuth error response from Microsoft', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    verifyOAuthStateMock.mockResolvedValue(true)
    const req = new Request('https://example.test/api/integrations/microsoft/callback?error=access_denied&state=s')
    const res = await callbackGET(req as never)
    expect(res.headers.get('location')).toContain('ms_error=oauth_failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('missing/mismatched state fails closed before any Forbidden/unauthorized branch could leak information — state is checked unconditionally after the access check', () => {
    const accessCheckIndex = CALLBACK_EXECUTABLE.indexOf('requireGlobalIntegrationAccess')
    const stateCheckIndex = CALLBACK_EXECUTABLE.indexOf('verifyOAuthState')
    expect(accessCheckIndex).toBeGreaterThan(-1)
    expect(stateCheckIndex).toBeGreaterThan(accessCheckIndex)
  })
})

// ── 7. TENANT/ENDPOINT ──────────────────────────────────────────────────

describe('Microsoft tenant/endpoint correctness (test 7)', () => {
  it('test 7: login redirects to the single-tenant authorize endpoint for the configured tenant, not /common/ or /organizations/', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    createOAuthStateMock.mockResolvedValue('s')
    const res = await loginGET()
    const location = res.headers.get('location')!
    expect(location.startsWith('https://login.microsoftonline.com/test-tenant-id/oauth2/v2.0/authorize')).toBe(true)
    expect(location).not.toContain('/common/')
    expect(location).not.toContain('/organizations/')
  })

  it('the callback exchanges the code against the same single-tenant token endpoint', () => {
    expect(CALLBACK_EXECUTABLE).toContain('https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token')
  })
})

// ── 8/9/10/11/12. SCOPES ────────────────────────────────────────────────

describe('Scopes are exactly the approved minimal set (tests 8-12)', () => {
  const scopeList = MS365_SCOPES.split(' ')

  it('test 8: scopes are exactly openid profile email offline_access Calendars.Read', () => {
    expect(MS365_SCOPES).toBe('openid profile email offline_access Calendars.Read')
  })

  it('test 9: Calendars.ReadWrite is absent', () => {
    expect(scopeList).not.toContain('Calendars.ReadWrite')
  })

  it('test 10: Mail.Read is absent', () => {
    expect(scopeList).not.toContain('Mail.Read')
  })

  it('test 11: Mail.Send is absent', () => {
    expect(scopeList).not.toContain('Mail.Send')
    expect(scopeList).not.toContain('Mail.ReadWrite')
  })

  it('test 12: no Bookings/Files/Contacts/Directory scope is present', () => {
    for (const scope of scopeList) {
      expect(scope).not.toMatch(/Booking|Files\.|Contacts\.|Directory\./)
    }
  })

  it('login and the refresh call both use the same single MS365_SCOPES constant — no second, independently-drifting scope list exists', () => {
    expect(LOGIN_EXECUTABLE).toContain('MS365_SCOPES')
    expect(TOKENS_EXECUTABLE).toContain('scope: MS365_SCOPES')
  })
})

// ── 13/14/15. TOKEN STORAGE SECRECY ─────────────────────────────────────

describe('Tokens are never stored/returned/logged in plaintext (tests 13, 14, 15)', () => {
  it('test 13: writeConnection() stores encrypted ciphertext, never the plaintext token value', async () => {
    queue([], [{ id: 'row-1' }])
    await writeConnection({
      accountEmail: 'james@brainbase.example', tenantId: 'test-tenant-id',
      accessToken: 'PLAINTEXT_ACCESS_TOKEN_VALUE', refreshToken: 'PLAINTEXT_REFRESH_TOKEN_VALUE',
      expiresAt: Date.now() + 3600_000,
    })
    expect(transactionMock).toHaveBeenCalledTimes(1)
    const insertCallArgs = sqlCallArgs(1) // [0]=DELETE, [1]=INSERT
    const insertValues = insertCallArgs.slice(1)
    expect(insertValues).not.toContain('PLAINTEXT_ACCESS_TOKEN_VALUE')
    expect(insertValues).not.toContain('PLAINTEXT_REFRESH_TOKEN_VALUE')
    const encryptedAccess = insertValues.find(v => typeof v === 'string' && /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/.test(v))
    expect(encryptedAccess).toBeDefined()
  })

  it('test 14: GET status never returns a token value — only connected/email', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    queue([{ account_email: 'james@brainbase.example' }])
    const res = await statusGET()
    const json = await res.json()
    expect(Object.keys(json).sort()).toEqual(['connected', 'email'])
    expect(JSON.stringify(json)).not.toMatch(/token|secret/i)
  })

  it('test 15: no console.log/warn/error call anywhere in the new files interpolates a raw access/refresh token value (naming the field in a static error string, e.g. "missing access_token/refresh_token", is fine — passing the variable itself, e.g. `${access_token}` or a bare `, accessToken`, is not)', () => {
    const valueLeakPattern = /\$\{(access_token|refresh_token|accessToken|refreshToken)\}|,\s*(access_token|refresh_token|accessToken|refreshToken)\s*[,)]/
    for (const src of [CALLBACK_EXECUTABLE, TOKENS_EXECUTABLE, LOGIN_EXECUTABLE, STATUS_EXECUTABLE]) {
      const consoleLines = src.split('\n').filter(l => /console\.(log|warn|error)/.test(l))
      for (const line of consoleLines) {
        expect(line).not.toMatch(valueLeakPattern)
      }
    }
  })

  it('getConnectionSummary() never selects the encrypted token columns at all — status can never leak them even by accident', () => {
    const start = TOKENS_SOURCE.indexOf('export async function getConnectionSummary')
    const end = TOKENS_SOURCE.indexOf('\n}', start)
    const body = TOKENS_SOURCE.slice(start, end)
    expect(body).not.toContain('encrypted_access_token')
    expect(body).not.toContain('encrypted_refresh_token')
  })
})

// ── 16/17/18. REFRESH TOKEN HANDLING ────────────────────────────────────

describe('Refresh token persistence (tests 16, 17, 18)', () => {
  it('test 16: refreshing an expired connection persists the new access token via a real write', async () => {
    const expiredRow = {
      account_email: 'james@brainbase.example', ms_tenant_id: 'test-tenant-id',
      encrypted_access_token: encryptForTest('old-access'), encrypted_refresh_token: encryptForTest('old-refresh'),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    }
    queue([expiredRow], [], [{ id: 'row-1' }]) // readConnection, then DELETE, then INSERT (via transaction)
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }),
    })
    const token = await getValidAccessToken()
    expect(token).toBe('new-access')
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it('test 17: a replacement refresh token from Microsoft is what gets persisted', async () => {
    const expiredRow = {
      account_email: 'james@brainbase.example', ms_tenant_id: 'test-tenant-id',
      encrypted_access_token: encryptForTest('old-access'), encrypted_refresh_token: encryptForTest('old-refresh'),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    }
    queue([expiredRow], [], [{ id: 'row-1' }])
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'new-access', refresh_token: 'brand-new-refresh', expires_in: 3600 }),
    })
    await getValidAccessToken()
    const insertValues = sqlCallArgs(2).slice(1) // DELETE(1)+INSERT(2) inside the transaction, after the initial read(0)
    const encryptedRefresh = insertValues[3] as string // account_email, ms_tenant_id, encrypted_access, encrypted_refresh
    expect(decryptForTest(encryptedRefresh)).toBe('brand-new-refresh')
  })

  it('test 18: a refresh response with no replacement refresh_token preserves the existing one', async () => {
    const expiredRow = {
      account_email: 'james@brainbase.example', ms_tenant_id: 'test-tenant-id',
      encrypted_access_token: encryptForTest('old-access'), encrypted_refresh_token: encryptForTest('old-refresh'),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    }
    queue([expiredRow], [], [{ id: 'row-1' }])
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'new-access', expires_in: 3600 }), // no refresh_token field
    })
    await getValidAccessToken()
    const insertValues = sqlCallArgs(2).slice(1)
    const encryptedRefresh = insertValues[3] as string
    expect(decryptForTest(encryptedRefresh)).toBe('old-refresh')
  })

  it('a still-valid (non-expired) connection never triggers a refresh call at all', async () => {
    const freshRow = {
      account_email: 'james@brainbase.example', ms_tenant_id: 'test-tenant-id',
      encrypted_access_token: encryptForTest('still-good'), encrypted_refresh_token: encryptForTest('still-good-refresh'),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }
    queue([freshRow])
    const token = await getValidAccessToken()
    expect(token).toBe('still-good')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ── 19/20. CONNECTION STATE TRUTHFULNESS ────────────────────────────────

describe('Connection state semantics (tests 19, 20)', () => {
  it('test 19: connection state is not_connected when no row is persisted', async () => {
    queue([])
    const state = await getMicrosoftState()
    expect(state).toBe('not_connected')
    const summary = await (async () => { queue([]); return getConnectionSummary() })()
    expect(summary).toBeNull()
  })

  it('test 20: connection state is connected only when a stored row actually exists', async () => {
    queue([{ account_email: 'james@brainbase.example' }])
    const state = await getMicrosoftState()
    expect(state).toBe('connected')
  })

  it('getMicrosoftState never means "Microsoft Graph is currently reachable" — no live Graph call is made by it', () => {
    const start = SIGNALS_SOURCE.indexOf('export async function getMicrosoftState')
    const end = SIGNALS_SOURCE.indexOf('\n}', start)
    const body = SIGNALS_SOURCE.slice(start, end)
    expect(body).not.toContain('fetch(')
    expect(body).not.toContain('graph.microsoft.com')
  })

  it('DELETE status clears the stored connection (disconnect)', async () => {
    requireGlobalIntegrationAccessMock.mockResolvedValue(AUTHORIZED)
    queue([])
    const res = await statusDELETE(new Request('https://example.test') as never)
    expect(res.status).toBe(200)
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect((sqlCallArgs(0)[0] as TemplateStringsArray).join('')).toContain('DELETE FROM microsoft_connections')
  })
})

// ── 21/22. FOUNDER SYSTEM API ────────────────────────────────────────────

describe('Founder System API integration (tests 21, 22)', () => {
  it('test 21: the system route still enforces requireFounderSession (super_admin only) — unaffected by this addition', () => {
    expect(SYSTEM_ROUTE_SOURCE).toContain('requireFounderSession');
    expect(SYSTEM_ROUTE_SOURCE).toContain("session.role !== 'super_admin'");
  })

  it('test 22: microsoft365 is included in the Founder System services response shape', () => {
    expect(SYSTEM_ROUTE_SOURCE).toContain('getMicrosoftState,')
    expect(SYSTEM_ROUTE_SOURCE).toContain('microsoft365: { state: microsoft365 },')
    expect(SYSTEM_ROUTE_SOURCE).toContain('getMicrosoftState(),')
  })
})

// ── 23/24/25. GMAIL/GCAL/INSTAGRAM REGRESSION ────────────────────────────

describe('Existing service signals remain intact (tests 23, 24, 25)', () => {
  it('test 23/24: gmail and googleCalendar signal functions are untouched in source', () => {
    expect(SIGNALS_SOURCE).toContain('export function getGmailState(): ConnectionState {')
    expect(SIGNALS_SOURCE).toContain('export function getGoogleCalendarState(): ConnectionState {')
    expect(SIGNALS_SOURCE).toContain("return readGmailTokens() ? 'connected' : 'not_connected';")
  })

  it('test 25: instagram signal function is untouched in source', () => {
    expect(SIGNALS_SOURCE).toContain('export async function getInstagramState(): Promise<ConnectionState> {')
  })

  it('the system route still requests gmail/googleCalendar/instagram state exactly as before', () => {
    expect(SYSTEM_ROUTE_SOURCE).toContain('gmail: { state: getGmailState() },')
    expect(SYSTEM_ROUTE_SOURCE).toContain('googleCalendar: { state: getGoogleCalendarState() },')
    expect(SYSTEM_ROUTE_SOURCE).toContain('instagram: { state: instagram },')
  })
})

// ── 26. SYSTEM UI ─────────────────────────────────────────────────────────

describe('System UI renders Microsoft 365 (test 26)', () => {
  it('test 26: the service-connections tile list includes Microsoft 365, bound to services.microsoft365.state', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("['Microsoft 365', services.microsoft365.state]")
  })

  it('the FounderSystemData type includes microsoft365 in its services shape', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain('microsoft365: { state: FounderConnectionState };')
  })
})

// ── 27/28/29. SCOPE CONTAINMENT — NO CALENDAR/MAIL/BOOKINGS ──────────────

describe('E.5A scope containment: no calendar/mail/Bookings functionality (tests 27, 28, 29)', () => {
  it('test 27: no calendar-event fetch exists anywhere in the new Microsoft files', () => {
    for (const src of [CALLBACK_EXECUTABLE, TOKENS_EXECUTABLE, LOGIN_EXECUTABLE, STATUS_EXECUTABLE]) {
      expect(src).not.toMatch(/\/me\/events|\/me\/calendar\b|calendarView/)
    }
  })

  it('test 28: no mail fetch/send exists anywhere in the new Microsoft files', () => {
    for (const src of [CALLBACK_EXECUTABLE, TOKENS_EXECUTABLE, LOGIN_EXECUTABLE, STATUS_EXECUTABLE]) {
      expect(src).not.toMatch(/\/me\/messages|sendMail|\/me\/mailFolders/)
    }
  })

  it('test 29: no Microsoft Bookings implementation exists anywhere in the new Microsoft files', () => {
    for (const src of [CALLBACK_EXECUTABLE, TOKENS_EXECUTABLE, LOGIN_EXECUTABLE, STATUS_EXECUTABLE]) {
      expect(src).not.toMatch(/bookingBusinesses|BookingsAppointment/)
    }
  })

  it('the callback identity check touches only /me (no $expand, no /me/events, no /me/messages)', () => {
    expect(CALLBACK_EXECUTABLE).toContain('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName')
  })
})

// ── 30. GOOGLE UNTOUCHED ──────────────────────────────────────────────────

describe('Google Gmail/GCal implementation is untouched (test 30)', () => {
  it('test 30: Gmail login route and Gmail/GCal token stores still carry their established markers, unmodified', () => {
    expect(GMAIL_LOGIN_SOURCE).toContain("requireGlobalIntegrationAccess('GMAIL_OWNER_ORG_ID'")
    expect(GMAIL_TOKENS_SOURCE).toContain("path.join(process.cwd(), '.brainbase', 'gmail_tokens.json')")
    expect(GCAL_TOKENS_SOURCE).toContain("path.join(process.cwd(), '.brainbase', 'gcal_tokens.json')")
  })
})

// ── 31. NO UNRELATED FOUNDER OS SECTION CHANGED ──────────────────────────

describe('No unrelated Founder OS section changed (test 31)', () => {
  it('ProductUsage, SystemHealth loading/error states, and the Database tile remain exactly as established', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("fetch('/api/founder/usage')")
    expect(FOUNDER_PAGE_SOURCE).toContain("['Uploads', data.uploads]")
    expect(FOUNDER_PAGE_SOURCE).toContain("const dbLabel = database.ok ? 'Operational' : 'Unavailable';")
  })

  it('Command and Organiser pages are untouched (established markers still present)', () => {
    const commandSource = fs.readFileSync(path.resolve(__dirname, '../../app/command/page.tsx'), 'utf-8')
    const organiserSource = fs.readFileSync(path.resolve(__dirname, '../../app/organiser/page.tsx'), 'utf-8')
    expect(commandSource).toContain('Demo Environment')
    expect(organiserSource).toContain('export default function OrganiserPage() {')
  })

  it('the Founder attention-queue and Founder Tasks routes are untouched', () => {
    const attnSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/attention-queue/route.ts'), 'utf-8')
    const tasksSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/tasks/route.ts'), 'utf-8')
    expect(attnSource).toContain("const REQUEST_ACTIONABLE_STATUSES = ['new', 'in_progress'];")
    expect(tasksSource).toContain('FROM organiser_items')
  })
})

// ── Helpers (use the real crypto module directly, not mocked) ───────────

// Imported dynamically inside a function (not at module top-level) so it
// participates in the same non-mocked resolution as the code under test.
import { encrypt as _encrypt, decrypt as _decrypt } from '@/lib/social/crypto'
function encryptForTest(v: string): string { return _encrypt(v) }
function decryptForTest(v: string): string { return _decrypt(v) }

// Sanity: readConnection()/clearConnection() are exercised indirectly
// above via getValidAccessToken()/DELETE; this asserts their own shape
// once more directly for completeness.
describe('readConnection / clearConnection direct coverage', () => {
  it('readConnection returns null when no row exists', async () => {
    queue([])
    expect(await readConnection()).toBeNull()
  })

  it('clearConnection issues a single DELETE', async () => {
    queue([])
    await clearConnection()
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect((sqlCallArgs(0)[0] as TemplateStringsArray).join('')).toContain('DELETE FROM microsoft_connections')
  })
})

// ── Production schema pre-flight correction ──────────────────────────────
//
// A read-only Production pre-flight (Neon, SELECT-only introspection
// against pg_proc/pg_trigger) confirmed public.set_updated_at() already
// exists, with exactly the expected body, and is already relied on by
// two other tables' triggers (web_service_leads, implementations). The
// schema script originally included a CREATE OR REPLACE FUNCTION
// set_updated_at() block for standalone-runnability; that block was
// removed once Production evidence showed the function already exists,
// since redefining a shared, multi-table function for a new table's
// benefit is an unnecessary, non-additive change to an object two
// unrelated existing tables depend on. This suite proves the corrected
// script only creates the new table/trigger, only ever REFERENCES
// set_updated_at() by name, and never creates/replaces/alters/drops any
// existing schema object.

describe('scripts/create-microsoft-connections.sql — reuses the confirmed-existing Production set_updated_at(), never redefines it', () => {
  it('does NOT contain CREATE OR REPLACE FUNCTION set_updated_at (or any CREATE FUNCTION at all)', () => {
    expect(SCHEMA_SCRIPT_EXECUTABLE).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i)
  })

  it('does NOT DROP or ALTER the existing shared function, or ALTER/DROP any existing table', () => {
    expect(SCHEMA_SCRIPT_EXECUTABLE).not.toMatch(/DROP\s+FUNCTION/i)
    expect(SCHEMA_SCRIPT_EXECUTABLE).not.toMatch(/ALTER\s+FUNCTION/i)
    expect(SCHEMA_SCRIPT_EXECUTABLE).not.toMatch(/ALTER\s+TABLE/i)
    expect(SCHEMA_SCRIPT_EXECUTABLE).not.toMatch(/DROP\s+TABLE/i)
  })

  it('creates exactly one new table (microsoft_connections) and references no other table', () => {
    const createTableMatches = [...SCHEMA_SCRIPT_EXECUTABLE.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi)]
    expect(createTableMatches).toHaveLength(1)
    expect(createTableMatches[0][1]).toBe('microsoft_connections')
    expect(SCHEMA_SCRIPT_EXECUTABLE).not.toContain('web_service_leads')
    expect(SCHEMA_SCRIPT_EXECUTABLE).not.toContain('implementations')
  })

  it('creates exactly one new trigger, on microsoft_connections only, and never drops an existing trigger by name', () => {
    const createTriggerMatches = [...SCHEMA_SCRIPT_EXECUTABLE.matchAll(/CREATE\s+TRIGGER\s+(\w+)/gi)]
    expect(createTriggerMatches).toHaveLength(1)
    expect(createTriggerMatches[0][1]).toBe('trg_microsoft_connections_updated_at')
    const dropTriggerMatches = [...SCHEMA_SCRIPT_EXECUTABLE.matchAll(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+(\w+)/gi)]
    expect(dropTriggerMatches).toHaveLength(1)
    expect(dropTriggerMatches[0][1]).toBe('trg_microsoft_connections_updated_at')
    expect(SCHEMA_SCRIPT_EXECUTABLE).not.toContain('trg_web_service_leads_updated_at')
    expect(SCHEMA_SCRIPT_EXECUTABLE).not.toContain('trg_implementations_updated_at')
  })

  it('the new trigger executes set_updated_at() by reference, without redefining it', () => {
    expect(SCHEMA_SCRIPT_EXECUTABLE).toMatch(/EXECUTE\s+FUNCTION\s+public\.set_updated_at\(\)/i)
  })

  it('no unrelated schema object (table, function, trigger, extension, type) appears anywhere in the script', () => {
    const createStatements = [...SCHEMA_SCRIPT_EXECUTABLE.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(TABLE|FUNCTION|TRIGGER|TYPE|EXTENSION|INDEX)\b[^;]*/gi)]
      .map(m => m[0].replace(/\s+/g, ' ').trim())
    expect(createStatements).toHaveLength(2) // the one CREATE TABLE, the one CREATE TRIGGER
    expect(createStatements.some(s => /^CREATE TABLE IF NOT EXISTS microsoft_connections\b/i.test(s))).toBe(true)
    expect(createStatements.some(s => /^CREATE TRIGGER trg_microsoft_connections_updated_at\b/i.test(s))).toBe(true)
  })
})
