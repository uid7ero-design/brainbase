import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Eve Phase 3.4 — organiser Settings, READ-ONLY. Authorization, tenant scoping,
// projection and the absence of any mutation. The SQL is proven against real
// Postgres in ticketingOrganiserSettingsRealPostgres.test.ts.

process.env.EVE_SESSION_SECRET = 'eve-test-secret-0123456789abcdef0123456789abcdef'
process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'
process.env.EVE_PUBLIC_BASE_URL = 'https://eve.example'

type Row = Record<string, unknown>
const db: { users: Row[]; orgs: Row[]; entitled: Set<string> } = { users: [], orgs: [], entitled: new Set() }

vi.mock('@/lib/db', () => ({
  default: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join('?')
    if (q.includes('FROM users WHERE id')) return db.users.filter(u => u.id === values[values.length - 1]).map(u => ({ ...u, session_live: true }))
    if (q.includes('FROM organisations WHERE id')) return db.orgs.filter(o => o.id === values[0])
    return []
  },
}))
vi.mock('@/lib/capabilities/requireCapability', async orig => {
  const actual = await orig<typeof import('@/lib/capabilities/requireCapability')>()
  return {
    ...actual,
    requireCapability: async (org: string) => {
      if (!db.entitled.has(org)) throw new actual.CapabilityAccessError('NO_ENTITLEMENT')
      return { key: 'events', config: { secretish: 'must-never-be-returned' } }
    },
  }
})

const reads = { getOrganisationRow: vi.fn(), getOwnEvent: vi.fn(), countEventFeeOverrides: vi.fn(), resolveEffectiveFeePolicy: vi.fn() }
vi.mock('@/lib/events/organiserSettings', async orig => {
  const actual = await orig<typeof import('@/lib/events/organiserSettings')>()
  return {
    ...actual,
    getOrganisationRow: (...a: unknown[]) => reads.getOrganisationRow(...a),
    getOwnEvent: (...a: unknown[]) => reads.getOwnEvent(...a),
    countEventFeeOverrides: (...a: unknown[]) => reads.countEventFeeOverrides(...a),
    resolveEffectiveFeePolicy: (...a: unknown[]) => reads.resolveEffectiveFeePolicy(...a),
  }
})
const connect = { getConnectAccountState: vi.fn(), checkPaidTicketingEligibility: vi.fn() }
vi.mock('@/lib/events/stripeConnect', () => ({
  getConnectAccountState: (...a: unknown[]) => connect.getConnectAccountState(...a),
  checkPaidTicketingEligibility: (...a: unknown[]) => connect.checkPaidTicketingEligibility(...a),
}))
vi.mock('@/lib/events/organiserPayments', () => ({ listPaymentOrders: vi.fn(), getPaymentOrder: vi.fn() }))
vi.mock('@/lib/events/organiserReads', () => ({ listOrganisationEvents: vi.fn(), getOrganisationEvent: vi.fn(), listEventRegistrationRows: vi.fn() }))
vi.mock('@/lib/events/checkIn', () => ({ resolveAttendee: vi.fn(), searchAttendees: vi.fn() }))
vi.mock('@/lib/events/checkInOps', () => ({ eventBelongsToOrganisation: vi.fn(), confirmCheckInWithAudit: vi.fn(), undoCheckInWithAudit: vi.fn() }))

const org = await import('@/lib/ticketing/organiserApi')
const { normaliseFeePolicyRow } = await import('@/lib/events/services/fees')
const { issueTicketingSession } = await import('@/lib/ticketing/session')

const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }
const tok = async (u: string, o: string) => (await issueTicketingSession(u, o))!.token
async function authed(userId = 'u-mgr', orgId = 'org-a', extra: Record<string, string> = {}, url = 'http://bb.test/x') {
  return new Request(url, { method: 'GET', headers: { ...GATE, 'x-ticketing-session': await tok(userId, orgId), ...extra } })
}
const json = async (res: Response) => (await res.json()) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const policyRow = (over: Record<string, unknown> = {}) => ({
  id: 'pol-1', organisation_id: 'org-a', event_id: null, enabled: true, fee_mode: 'PASS_THROUGH', percent_bps: 250,
  fixed_per_order_cents: 30, fixed_per_ticket_cents: 0, min_fee_cents: null, max_fee_cents: null, currency: 'aud', label: 'Booking fee',
  tax_treatment: 'UNSPECIFIED', version: 3, ...over,
})
const CONNECTED = { status: 'CONNECTED', accountId: 'acct_SECRET123', chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, connectedAt: '2026-09-01T00:00:00.000Z', lastSyncedAt: '2026-10-10T00:00:00.000Z' }
const NOT_CONNECTED = { status: 'NOT_CONNECTED', accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, connectedAt: null, lastSyncedAt: null }

beforeEach(() => {
  for (const f of [...Object.values(reads), ...Object.values(connect)]) f.mockReset()
  db.entitled = new Set(['org-a', 'org-b'])
  db.orgs = [
    { id: 'org-a', name: 'Acme Events', slug: 'acme', status: 'ACTIVE', settings: { events: { eveEnabled: true } } },
    { id: 'org-b', name: 'B', slug: 'b', status: 'ACTIVE', settings: { events: { eveEnabled: true } } },
  ]
  db.users = [
    { id: 'u-mgr', organisation_id: 'org-a', role: 'MANAGER', status: 'ACTIVE', name: 'Mgr' },
    { id: 'u-view', organisation_id: 'org-a', role: 'VIEWER', status: 'ACTIVE', name: 'View' },
    { id: 'u-b', organisation_id: 'org-b', role: 'ADMIN', status: 'ACTIVE', name: 'B user' },
  ]
  reads.getOrganisationRow.mockResolvedValue({ id: 'org-a', name: 'Acme Events', slug: 'acme', settings: {} })
  reads.getOwnEvent.mockResolvedValue(null)
  reads.countEventFeeOverrides.mockResolvedValue(0)
  reads.resolveEffectiveFeePolicy.mockImplementation(async () => normaliseFeePolicyRow(null))
  connect.getConnectAccountState.mockResolvedValue(CONNECTED)
  connect.checkPaidTicketingEligibility.mockResolvedValue({ eligible: true, accountId: 'acct_SECRET123' })
})

const get = async (userId = 'u-view', qs = '') => org.handleOrganiserSettings(await authed(userId, 'org-a', {}, `http://bb.test/x${qs}`))

describe('authorization', () => {
  it('denies without the gate, without a session, and with a browser origin — before any read', async () => {
    expect((await org.handleOrganiserSettings(new Request('http://bb.test/x'))).status).toBe(401)
    expect((await org.handleOrganiserSettings(new Request('http://bb.test/x', { headers: GATE }))).status).toBe(401)
    expect((await org.handleOrganiserSettings(await authed('u-mgr', 'org-a', { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await org.handleOrganiserSettings(await authed('u-mgr', 'org-a', { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    for (const f of Object.values(reads)) expect(f).not.toHaveBeenCalled()
    expect(connect.getConnectAccountState).not.toHaveBeenCalled()
  })

  it('viewer and manager may both read', async () => {
    for (const u of ['u-view', 'u-mgr']) {
      const res = await get(u)
      expect(res.status).toBe(200)
      expect((await json(res)).user).toMatchObject({ role: u === 'u-view' ? 'viewer' : 'manager' })
    }
  })

  it('an organisation WITH Events enabled reports it; one WITHOUT (or after removal) is denied before any read', async () => {
    expect((await json(await get())).events_capability).toEqual({ enabled: true })
    db.entitled.delete('org-a')
    expect((await get()).status).toBe(403)
    expect(reads.getOrganisationRow).toHaveBeenCalledTimes(1) // only the earlier, entitled call
  })

  it('an inactive user is denied', async () => {
    db.users[1].status = 'INACTIVE'
    expect((await get('u-view')).status).toBe(401)
  })

  it('a token for another organisation cannot be used by this user (cross-tenant)', async () => {
    expect((await org.handleOrganiserSettings(await authed('u-b', 'org-a'))).status).toBe(401)
  })

  it('reads are scoped to the organisation reloaded from the database, never to anything in the request', async () => {
    await org.handleOrganiserSettings(await authed('u-mgr', 'org-a', { 'x-organisation-id': 'org-b' }, 'http://bb.test/x?organisationId=org-b'))
    expect(reads.getOrganisationRow).toHaveBeenCalledWith('org-a')
    expect(reads.resolveEffectiveFeePolicy).toHaveBeenCalledWith('org-a', null)
    expect(reads.countEventFeeOverrides).toHaveBeenCalledWith('org-a')
    expect(connect.getConnectAccountState).toHaveBeenCalledWith('org-a')
  })

  it('?event= of another tenant (or unknown) is a 404 and resolves no policy; a malformed id is a 400', async () => {
    reads.getOwnEvent.mockResolvedValue(null)
    const res = await get('u-view', '?event=event-of-org-b')
    expect(res.status).toBe(404)
    expect(reads.getOwnEvent).toHaveBeenCalledWith('org-a', 'event-of-org-b')
    expect(reads.resolveEffectiveFeePolicy).not.toHaveBeenCalled()
    expect((await get('u-view', '?event=a%20b')).status).toBe(400)
  })
})

describe('Connect presentation (cached state only, never the account id)', () => {
  const cases: [string, Record<string, unknown>, boolean, Record<string, unknown>][] = [
    ['NOT_CONNECTED', NOT_CONNECTED, false, { connected: false, charges_enabled: false }],
    ['ONBOARDING', { ...NOT_CONNECTED, status: 'ONBOARDING', accountId: 'acct_SECRET123' }, false, { connected: true, details_submitted: false }],
    ['ACTION_REQUIRED', { ...CONNECTED, status: 'ACTION_REQUIRED', chargesEnabled: false, payoutsEnabled: false }, false, { connected: true, charges_enabled: false }],
    ['CONNECTED', CONNECTED, true, { connected: true, charges_enabled: true, payouts_enabled: true }],
    ['RESTRICTED', { ...CONNECTED, status: 'RESTRICTED', chargesEnabled: false, payoutsEnabled: false }, false, { connected: true, charges_enabled: false }],
  ]
  for (const [status, state, eligible, extra] of cases) {
    it(status, async () => {
      connect.getConnectAccountState.mockResolvedValue(state)
      connect.checkPaidTicketingEligibility.mockResolvedValue(eligible ? { eligible: true, accountId: 'x' } : { eligible: false, reason: 'Connect Stripe before selling paid tickets.' })
      const body = await json(await get())
      expect(body.connect).toMatchObject({ status, eligible_for_paid_ticketing: eligible, ...extra })
      expect(body.ticketing).toEqual({ paid_ticketing_available: eligible })
    })
  }
  it('a Connect read failure degrades to null / unknown, not a 500', async () => {
    connect.getConnectAccountState.mockRejectedValue(new Error('boom'))
    const body = await json(await get())
    expect(body.connect).toBeNull()
    expect(body.ticketing.paid_ticketing_available).toBeNull()
  })
})

describe('fee policy presentation (the checkout resolver, never order snapshots)', () => {
  it('no fee configured anywhere: platform default => NO_FEE / NOT_CONFIGURED', async () => {
    expect((await json(await get())).fees.effective).toEqual({ state: 'NO_FEE', source: 'PLATFORM_DEFAULT', reason: 'NOT_CONFIGURED' })
  })
  it('pass-through organisation policy: the buyer pays', async () => {
    reads.resolveEffectiveFeePolicy.mockResolvedValue(normaliseFeePolicyRow(policyRow()))
    reads.countEventFeeOverrides.mockResolvedValue(2)
    const { fees } = await json(await get())
    expect(fees.scope).toEqual({ level: 'ORGANISATION', event: null })
    expect(fees.effective).toEqual({
      state: 'FEE', source: 'ORGANISATION', fee_mode: 'PASS_THROUGH', paid_by: 'BUYER', percent_bps: 250, fixed_per_order_cents: 30,
      fixed_per_ticket_cents: 0, min_fee_cents: null, max_fee_cents: null, currency: 'AUD', label: 'Booking fee',
    })
    expect(fees.event_overrides_count).toBe(2)
  })
  it('absorb policy: the organiser pays', async () => {
    reads.resolveEffectiveFeePolicy.mockResolvedValue(normaliseFeePolicyRow(policyRow({ fee_mode: 'ABSORB', label: 'Platform fee' })))
    expect((await json(await get())).fees.effective).toMatchObject({ fee_mode: 'ABSORB', paid_by: 'ORGANISER', label: 'Platform fee' })
  })
  it('a disabled organisation row means no fee, and says it is disabled rather than inherited', async () => {
    reads.resolveEffectiveFeePolicy.mockResolvedValue(normaliseFeePolicyRow(policyRow({ enabled: false })))
    expect((await json(await get())).fees.effective).toEqual({ state: 'NO_FEE', source: 'ORGANISATION', reason: 'DISABLED' })
  })
  it('event scope: the event row wins; the response names the event and passes only its id to the resolver', async () => {
    reads.getOwnEvent.mockResolvedValue({ id: 'ev-1', name: 'Gala' })
    reads.resolveEffectiveFeePolicy.mockResolvedValue(normaliseFeePolicyRow(policyRow({ event_id: 'ev-1', fee_mode: 'ABSORB', percent_bps: 100 })))
    const { fees } = await json(await get('u-view', '?event=ev-1'))
    expect(reads.resolveEffectiveFeePolicy).toHaveBeenCalledWith('org-a', 'ev-1')
    expect(fees.scope).toEqual({ level: 'EVENT', event: { id: 'ev-1', name: 'Gala' } })
    expect(fees.effective).toMatchObject({ source: 'EVENT', fee_mode: 'ABSORB', percent_bps: 100 })
  })
  it('event with no row of its own inherits the organisation policy (source ORGANISATION)', async () => {
    reads.getOwnEvent.mockResolvedValue({ id: 'ev-2', name: 'Workshop' })
    reads.resolveEffectiveFeePolicy.mockResolvedValue(normaliseFeePolicyRow(policyRow()))
    expect((await json(await get('u-view', '?event=ev-2'))).fees.effective.source).toBe('ORGANISATION')
  })
  it('a policy row the resolver cannot interpret is reported unavailable (fail closed), not guessed', async () => {
    reads.resolveEffectiveFeePolicy.mockRejectedValue(new Error('Fee policy pol-1 has an unknown fee_mode.'))
    const res = await get()
    expect(res.status).toBe(200)
    expect((await json(res)).fees).toMatchObject({ unavailable: true, effective: null })
  })
  it('never returns the policy id, version or tax treatment', async () => {
    reads.resolveEffectiveFeePolicy.mockResolvedValue(normaliseFeePolicyRow(policyRow()))
    const s = JSON.stringify((await json(await get())).fees)
    expect(s).not.toMatch(/pol-1|version|tax_treatment|UNSPECIFIED/)
  })
})

describe('organisation and branding presentation', () => {
  it('historical / default organisation (empty settings): no branding configured, display name is the organisation name', async () => {
    for (const settings of [{}, null, undefined, 'junk', { commercial: { x: 1 } }]) {
      reads.getOrganisationRow.mockResolvedValue({ id: 'org-a', name: 'Acme Events', slug: 'acme', settings })
      const body = await json(await get())
      expect(body.organisation).toEqual({ name: 'Acme Events', slug: 'acme' })
      expect(body.branding).toEqual({
        configured: false, display_name: 'Acme Events', display_name_is_custom: false, logo_configured: false, accent_color: null,
        website: null, support_email: null, support_phone: null, email_footer: null, public_email: null,
      })
    }
  })
  it('configured branding: safe fields shown, logo reported as set but its URL never returned, address/ABN/sender name excluded', async () => {
    reads.getOrganisationRow.mockResolvedValue({
      id: 'org-a', name: 'Acme Events', slug: 'acme',
      settings: { branding: { name: 'Acme Presents', logoUrl: 'https://blob.example/private/logo-SECRETTOKEN.png', accentColor: '#112233', email: 'help@acme.example', phone: '0400 000 000', website: 'https://acme.example', address: '1 Secret St', abn: '12 345 678 901', emailFooter: 'Thanks!', emailSenderName: 'Acme Sender' }, commercial: { businessProfile: { abn: '99' } } },
    })
    const body = await json(await get())
    expect(body.branding).toMatchObject({ configured: true, display_name: 'Acme Presents', display_name_is_custom: true, logo_configured: true, accent_color: '#112233', website: 'https://acme.example', support_email: 'help@acme.example', support_phone: '0400 000 000', email_footer: 'Thanks!' })
    expect(JSON.stringify(body)).not.toMatch(/blob\.example|SECRETTOKEN|1 Secret St|12 345 678 901|Acme Sender|businessProfile|"99"/)
  })
})

describe('no leakage, no mutation', () => {
  it('the response contains no provider id, secret, entitlement config, token or internal field', async () => {
    reads.resolveEffectiveFeePolicy.mockResolvedValue(normaliseFeePolicyRow(policyRow()))
    const s = JSON.stringify(await json(await get()))
    expect(s).not.toMatch(/acct_|SECRET|secretish|must-never|sk_|whsec_|stripe_|account_id|accountId|product_surface|token/i)
  })

  const ROOT = path.resolve(__dirname, '../..')
  const code = (f: string) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('the settings route exports GET only', () => {
    const exported = [...code('app/api/ticketing/organiser/settings/route.ts').matchAll(/export (?:async function|const|function) (\w+)/g)].map(m => m[1])
    expect(exported).toEqual(['GET'])
  })
  it('the settings read module issues SELECTs only, scoped by organisation, with no provider call', () => {
    const src = code('lib/events/organiserSettings.ts')
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i)
    expect(src).not.toMatch(/stripe|setOrganisationBranding|getOrCreateConnectedAccount|createOnboardingLink/i)
    expect(src.match(/organisation_id = \$\{organisationId\}|id = \$\{organisationId\}/g)?.length).toBeGreaterThanOrEqual(3)
  })
  it('the handlers import no write path', () => {
    expect(code('lib/ticketing/organiserApi.ts')).not.toMatch(/setOrganisationBranding|setBusinessProfile|createOnboardingLink|getOrCreateConnectedAccount|refreshConnectedAccountStatus/)
  })
})
