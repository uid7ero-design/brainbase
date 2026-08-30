import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Events Phase 4 final integration — navigation/dashboard discoverability,
// the public organisation events hub, and the retry return-flow slug fix.
// Every dependency is mocked — no real database, network, or Stripe call
// occurs anywhere in this file.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ─── Authenticated discoverability ─────────────────────────────────────

describe('TopNav — Events entry follows the exact same capability-gating pattern as every other module', () => {
  const code = stripComments(read('components/nav/TopNav.tsx'))

  it('OPS_ITEMS includes an Events entry routing to /events, gated by the existing "events" capability key', () => {
    const opsStart = code.indexOf('const OPS_ITEMS')
    const opsBody = code.slice(opsStart, code.indexOf('\n];', opsStart))
    expect(opsBody).toMatch(/label:\s*'Events'/)
    expect(opsBody).toMatch(/href:\s*'\/events'/)
    expect(opsBody).toMatch(/capabilityKey:\s*'events'/)
  })

  it('uses the SAME generic filter mechanism CRM already relies on — no special-cased branch for Events or for any organisation', () => {
    // The filter itself (items.filter(item => !item.capabilityKey ||
    // enabledCapabilities.includes(item.capabilityKey))) is shared code
    // that already runs for every OPS_ITEMS entry — proving Events sits
    // in that same array (previous test) is what proves it goes through
    // this identical, un-special-cased mechanism. This test additionally
    // confirms no LD-Tennis (or any other organisation) special case was
    // introduced anywhere near it.
    const opsStart = code.indexOf('const OPS_ITEMS')
    const dropdownEnd = code.indexOf('function OpsDropdown')
    const region = code.slice(opsStart, code.indexOf('\n}', code.indexOf('const items = OPS_ITEMS.filter', dropdownEnd)))
    expect(region).not.toMatch(/ld-tennis|LD Tennis|ld_tennis/i)
    expect(region).toMatch(/enabledCapabilities\.includes\(\s*item\.capabilityKey/)
  })

  it('no second/parallel navigation or capability system was introduced — Events reuses enabledCapabilities, the exact prop TopNav already receives from the session', () => {
    expect(code).toMatch(/enabledCapabilities\?:\s*string\[\]/)
  })
})

describe('Authenticated dashboard — no module-card/tile pattern exists to extend, and none was invented', () => {
  it('the org-variant dashboard resolver has no generic module-card system (a closed set of bespoke per-organisation dashboards only)', () => {
    const code = stripComments(read('app/dashboard/page.tsx'))
    // Confirms the dashboard remains its existing closed set of
    // variants (brainbase-hq / ld-tennis / generic fallback) — no new
    // "events" branch was added here, and no fourth special case was
    // introduced for this integration pass.
    expect(code).not.toMatch(/variant === 'events'/)
    expect(code).not.toMatch(/EventsDashboard/)
  })
})

// ─── Public organisation events hub ────────────────────────────────────

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const checkCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, checkCapability: (...args: unknown[]) => checkCapabilityMock(...args) }
})

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const { getPublicUpcomingEvents } = await import('@/lib/events/publicEventsHub')

beforeEach(() => {
  sqlMock.mockClear()
  checkCapabilityMock.mockReset()
  responseQueue = []
  callCount = 0
  checkCapabilityMock.mockResolvedValue({ allowed: true })
})

describe('getPublicUpcomingEvents — tenant scoping and public-eligibility filtering', () => {
  it('an unknown organisation slug resolves to { ok: false } — never a distinguishing detail', async () => {
    queue([])
    const result = await getPublicUpcomingEvents('unknown-org')
    expect(result.ok).toBe(false)
  })

  it('an organisation without the events capability resolves to { ok: false } (fails closed, matching resolvePublicEvent)', async () => {
    queue([{ id: 'org-a', name: 'Org A' }])
    checkCapabilityMock.mockResolvedValue({ allowed: false })
    const result = await getPublicUpcomingEvents('org-a')
    expect(result.ok).toBe(false)
  })

  it('a capability-lookup failure fails closed, never open', async () => {
    queue([{ id: 'org-a', name: 'Org A' }])
    checkCapabilityMock.mockResolvedValue({ allowed: false, reason: 'DATABASE_ERROR' })
    const result = await getPublicUpcomingEvents('org-a')
    expect(result.ok).toBe(false)
  })

  it('returns only PUBLISHED, non-past events — the query itself excludes CANCELLED/DRAFT/past events, never filtered client-side', async () => {
    queue(
      [{ id: 'org-a', name: 'Org A' }],
      [{ id: 'evt-1', name: 'Spring Fair', slug: 'spring-fair', venue: 'Hall', artwork_url: null, starts_at: new Date(), ends_at: new Date(), timezone: 'Australia/Adelaide', from_price_cents: 2500 }],
    )
    const result = await getPublicUpcomingEvents('org-a')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.events).toHaveLength(1)
      expect(result.events[0].slug).toBe('spring-fair')
    }
    const eventQueryCall = sqlMock.mock.calls[1] as unknown as TemplateStringsArray[]
    const sqlText = eventQueryCall[0].join('')
    expect(sqlText).toMatch(/status = 'PUBLISHED'/)
    expect(sqlText).toMatch(/ends_at >= NOW\(\)/)
  })

  it('never selects or exposes another organisation\'s events — the query is scoped by this organisation\'s own resolved id', () => {
    const code = stripComments(read('lib/events/publicEventsHub.ts'))
    expect(code).toMatch(/WHERE e\.organisation_id = \$\{org\.id\}/)
  })

  it('empty result set (no upcoming events) resolves ok with an empty array, not an error', async () => {
    queue([{ id: 'org-a', name: 'Org A' }], [])
    const result = await getPublicUpcomingEvents('org-a')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.events).toEqual([])
  })

  it('never hardcodes an organisation id, slug, or event slug anywhere in the reusable resolver', () => {
    const code = stripComments(read('lib/events/publicEventsHub.ts'))
    expect(code).not.toMatch(/ld-tennis|graduation/i)
  })
})

describe('Public events hub page/client — correct links, no hardcoded organisation', () => {
  it('the hub page resolves purely from the organisationSlug route param', () => {
    const code = stripComments(read('app/e/[organisationSlug]/page.tsx'))
    expect(code).not.toMatch(/ld-tennis|graduation/i)
  })

  it('each event card links to /e/[organisationSlug]/[eventSlug] using the resolved slugs, not any hardcoded value', () => {
    const code = stripComments(read('app/e/[organisationSlug]/PublicEventsHubClient.tsx'))
    expect(code).toMatch(/href=\{`\/e\/\$\{organisationSlug\}\/\$\{event\.slug\}`\}/)
    expect(code).not.toMatch(/ld-tennis|graduation/i)
  })

  it('shows an explicit empty state when there are no upcoming events', () => {
    const code = stripComments(read('app/e/[organisationSlug]/PublicEventsHubClient.tsx'))
    expect(code).toMatch(/No upcoming events/)
  })

  it('never exposes purchaser/order/internal data — only name, slug, venue, artwork, timing, and a derived from-price', () => {
    const code = stripComments(read('lib/events/publicEventsHub.ts'))
    expect(code).not.toMatch(/purchaser|order_id|organisation_id.*SELECT|attendee/i)
  })
})

// ─── LD Tennis / marketing discoverability ─────────────────────────────

describe('LD Tennis public site — Events link, not a hardcoded event', () => {
  it('links to the reusable hub (/e/ld-tennis), never directly to a specific event', () => {
    const code = stripComments(read('app/tennis/components/Nav.tsx'))
    expect(code).toMatch(/href="\/e\/ld-tennis"/)
    expect(code).not.toMatch(/year-12-graduation/)
  })
})

describe('BrainBase marketing site — Events & Ticketing as a first-class capability', () => {
  const code = stripComments(read('app/page.tsx'))

  it('CAPABILITIES includes an Events & Ticketing entry describing the actual product, not LD Tennis', () => {
    const start = code.indexOf('const CAPABILITIES')
    const body = code.slice(start, code.indexOf('\n];', start))
    expect(body).toMatch(/title:\s*'Events & Ticketing'/)
    expect(body).not.toMatch(/ld-tennis|LD Tennis/i)
  })

  it('never links directly to an LD Tennis (or any specific organisation\'s) event', () => {
    expect(code).not.toMatch(/\/e\/ld-tennis|year-12-graduation/i)
  })
})

// ─── Retry return-flow slug resolution (§Step 7) ───────────────────────

describe('Retry route — authoritative server-resolved slugs, never client-trusted', () => {
  const code = stripComments(read('app/api/events/[id]/orders/[orderId]/retry/route.ts'))

  it('reads no request body at all — there is nothing for a hostile/mismatched slug value to override', () => {
    expect(code).not.toMatch(/req\.json\(\)/)
    expect(code).not.toMatch(/body\.organisationSlug|body\.eventSlug/)
  })

  it('the event/organisation slugs come from the same tenant-scoped query that already verifies ownership', () => {
    const queryStart = code.indexOf('SELECT e.id, e.status, e.slug')
    expect(queryStart).toBeGreaterThan(-1)
    const queryRegion = code.slice(queryStart, code.indexOf('LIMIT 1', queryStart))
    expect(queryRegion).toMatch(/WHERE e\.id = \$\{eventId\} AND e\.organisation_id = \$\{session\.organisationId\}/)
  })

  it('success/cancel URLs always use the branded public flow with the resolved slugs — no generic manager-route fallback', () => {
    expect(code).toMatch(/successUrl = `\$\{origin\}\/e\/\$\{event\.org_slug\}\/\$\{event\.event_slug\}\/checkout\/success\?session_id=\{CHECKOUT_SESSION_ID\}`/)
    expect(code).toMatch(/cancelUrl = `\$\{origin\}\/e\/\$\{event\.org_slug\}\/\$\{event\.event_slug\}\?checkout=cancelled`/)
    expect(code).not.toMatch(/events\/\$\{eventId\}\?checkout=retry-success/)
  })

  it('every existing retry guarantee remains textually present and unchanged: manager+ auth, historical stripe_account_id, no INSERTs, capacity self-exclusion', () => {
    expect(code).toMatch(/authorizeEventsRequest\('manager'\)/)
    expect(code).toMatch(/connectedAccountId: order\.stripe_account_id/)
    expect(code).not.toMatch(/INSERT INTO event_orders|INSERT INTO event_order_items|INSERT INTO event_attendees/)
    expect(code).toMatch(/eo\.id <> \$\{orderId\}/)
  })
})
