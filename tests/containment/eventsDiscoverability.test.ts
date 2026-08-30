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

// Root-cause fix (visible-navigation defect investigation): Events was
// previously ONLY reachable via OPS_ITEMS inside the hover-only
// Operations dropdown, which itself is rendered ONLY in AppNav's
// non-isClientOrg branch. Because app/layout.tsx's serverSession never
// populates enabledModules (it only ever sets role/name/avatarUrl/
// enabledCapabilities — see that file), and AppNav derives
// isClientOrg = !isSuperAdmin && enabledModules.length === 0, EVERY
// non-super-admin authenticated user unconditionally takes the
// isClientOrg branch — a branch that had no Events entry, and no
// Operations dropdown, at all. This is what made Events genuinely
// invisible for LD Tennis (confirmed against a real DEV session:
// role "manager", enabledCapabilities ["crm","events"], yet the old
// isClientOrg branch rendered HLNA/Leads/Squad/Sessions/Requests/Blog
// only). The fix does not touch the (separately broken, out-of-scope)
// enabledModules/isClientOrg computation itself — it adds a
// capability-gated Events entry directly to BOTH branches of AppNav,
// so Events is visible regardless of which branch a session resolves
// to, and promotes it out of the Operations dropdown into an
// always-visible pill in the non-client branch too (a hover-only menu
// entry is not sufficiently discoverable for a major module).
describe('TopNav — Events is a first-class, always-visible entry in BOTH AppNav branches', () => {
  const code = stripComments(read('components/nav/TopNav.tsx'))

  it('OPS_ITEMS no longer contains Events — it was promoted out of the hover-only Operations dropdown', () => {
    const opsStart = code.indexOf('const OPS_ITEMS')
    const opsBody = code.slice(opsStart, code.indexOf('\n];', opsStart))
    expect(opsBody).not.toMatch(/label:\s*'Events'/)
  })

  it('an always-visible Events NavItem, gated by enabledCapabilities, exists in the isClientOrg branch (the branch LD Tennis actually renders)', () => {
    const clientBranchStart = code.indexOf('isClientOrg ? (')
    const clientBranchEnd = code.indexOf(') : (', clientBranchStart)
    expect(clientBranchStart).toBeGreaterThan(-1)
    const region = code.slice(clientBranchStart, clientBranchEnd)
    expect(region).toMatch(/enabledCapabilities\.includes\(\s*'events'\s*,?\s*\)/)
    expect(region).toMatch(/href="\/events"/)
    expect(region).toMatch(/label="Events"/)
  })

  it('an always-visible Events NavItem, gated by enabledCapabilities, also exists in the non-client (internal-staff) branch — not only inside the Operations dropdown', () => {
    const clientBranchEnd = code.indexOf(') : (')
    // A comment-free anchor: stripComments() already removed the JSX
    // comment that used to mark this boundary in the raw source, so
    // this slices up to the first real token of the far-right cluster
    // (the compact logo's wrapper width) instead.
    const nonClientBranchEnd = code.indexOf('width: 185,', clientBranchEnd)
    const region = code.slice(clientBranchEnd, nonClientBranchEnd)
    expect(region).toMatch(/enabledCapabilities\.includes\(\s*'events'\s*,?\s*\)/)
    expect(region).toMatch(/href="\/events"/)
    expect(region).toMatch(/label="Events"/)
  })

  it('href is exactly /events in both branches — never a different or LD-Tennis-specific route', () => {
    const matches = code.match(/href="\/events"/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
    expect(code).not.toMatch(/href="\/events\/ld-tennis|href="\/dashboard\/events/)
  })

  it('uses the SAME generic capability-gating mechanism CRM already relies on — no special-cased branch for Events or for any organisation', () => {
    expect(code).not.toMatch(/ld-tennis|LD Tennis|ld_tennis/i)
  })

  it('no second/parallel navigation or capability system was introduced — Events reuses enabledCapabilities, the exact prop TopNav already receives from the session', () => {
    expect(code).toMatch(/enabledCapabilities\?:\s*string\[\]/)
    expect(code).toMatch(/enabledCapabilities\s*=\s*\[\]/)
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

// Root-cause fix: the desktop link list (Coaching/About/Blog/Events)
// previously sat inside a bare `hidden md:flex` wrapper with NO mobile
// fallback at all — on any viewport narrower than Tailwind's md
// breakpoint, none of those links (Events included) were reachable,
// and there was no hamburger/menu toggle anywhere in the component. A
// browser observation of "the source has the link but I can't see or
// reach it" on a phone-width viewport would be entirely explained by
// this — distinct from (and in addition to) the authenticated-nav
// root cause above.
describe('LD Tennis public site — mobile fallback for the desktop-only link row', () => {
  const code = stripComments(read('app/tennis/components/Nav.tsx'))

  it('the desktop link row (including Events) is still gated behind md: (unchanged) — this alone would hide it on mobile without a fallback', () => {
    expect(code).toMatch(/hidden md:flex items-center gap-6/)
  })

  it('a hamburger/menu toggle button now exists, visible only below md:, with open/close state', () => {
    const buttonStart = code.indexOf('<button')
    expect(buttonStart).toBeGreaterThan(-1)
    const buttonBlock = code.slice(buttonStart, code.indexOf('</button>', buttonStart))
    expect(buttonBlock).toMatch(/md:hidden/)
    expect(buttonBlock).toMatch(/aria-label=/)
    expect(buttonBlock).toMatch(/aria-expanded=\{mobileOpen\}/)
    expect(buttonBlock).toMatch(/onClick=\{\(\) => setMobileOpen/)
  })

  it('the mobile menu panel is md:hidden (never shown once the desktop row is already visible) and contains an Events link to the same /e/ld-tennis destination', () => {
    const panelStart = code.indexOf('{mobileOpen && (')
    expect(panelStart).toBeGreaterThan(-1)
    const panelBody = code.slice(panelStart, code.indexOf('\n      )}', panelStart))
    expect(panelBody).toMatch(/md:hidden/)
    expect(panelBody).toMatch(/href="\/e\/ld-tennis"/)
    expect(panelBody).toMatch(/>Events</)
  })

  it('every link in the mobile panel closes the menu on click (setMobileOpen(false)) so navigating away doesn\'t leave a stale open menu behind', () => {
    const panelStart = code.indexOf('{mobileOpen && (')
    const panelBody = code.slice(panelStart, code.indexOf('\n      )}', panelStart))
    const linkCount = (panelBody.match(/<a |<Link /g) ?? []).length
    const closeCount = (panelBody.match(/setMobileOpen\(false\)/g) ?? []).length
    expect(closeCount).toBe(linkCount)
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
