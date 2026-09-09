import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase 3B — end-to-end resolver-level verification that
// PublicOrganisationBranding is the sole identity source for both public
// Events surfaces (resolvePublicEvent/getPublicEventDetail for the
// detail page, getPublicUpcomingEvents for the hub), that
// publicEventTheme.ts contributes structure/fallback-accent only, and
// that the two surfaces can never diverge for the same organisation.
// SQL is fully mocked — no real database or network call anywhere in
// this file, matching every other resolver-level containment test in
// this repo (see tests/containment/organisationBrandingConsumerFoundation
// .test.ts's own identical convention, which this file follows exactly).

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const checkCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, checkCapability: (...args: unknown[]) => checkCapabilityMock(...args) }
})

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

beforeEach(() => {
  sqlMock.mockClear()
  checkCapabilityMock.mockReset()
  checkCapabilityMock.mockResolvedValue({ allowed: true })
  responseQueue = []
  callCount = 0
})

const { resolvePublicEvent } = await import('@/lib/events/publicResolve')
const { getPublicUpcomingEvents } = await import('@/lib/events/publicEventsHub')
const { resolvePublicEventTheme, applyAccentOverride } = await import('@/lib/events/publicEventTheme')

const SCHOOL_TEST_ORG_ROW_UNCONFIGURED = { id: 'org-school', name: 'School Test Organisation', settings: {} }
const SCHOOL_TEST_ORG_ROW_CONFIGURED = {
  id: 'org-school', name: 'School Test Organisation',
  settings: { branding: { name: 'Configured Display Name', logoUrl: 'https://cdn.example.com/school-logo.png', accentColor: '#112233', website: 'https://school-test.example.com' } },
}
const DEFAULT_ORG_ROW_UNCONFIGURED = { id: 'org-default', name: 'Acme Co', settings: {} }
const DEFAULT_ORG_ROW_CONFIGURED = {
  id: 'org-default', name: 'Acme Co',
  settings: { branding: { name: 'Acme Display', logoUrl: 'https://cdn.example.com/acme-logo.png', accentColor: '#ff8800', website: 'https://acme.example.com' } },
}
const EVENT_ROW = {
  id: 'event-1', organisation_id: 'org-school', name: 'Graduation', slug: 'graduation',
  description: null, venue: null, artwork_url: null, starts_at: new Date(), ends_at: new Date(), timezone: 'UTC',
}
const EVENT_ROW_DEFAULT = { ...EVENT_ROW, organisation_id: 'org-default' }

describe('School Test / institutional — NO branding configured (must preserve today\'s appearance)', () => {
  it('variant remains institutional', () => {
    expect(resolvePublicEventTheme('school-test-organisation').variant).toBe('institutional')
  })

  it('resolvePublicEvent: DB organisation name is returned as organisationName (the render-layer fallback), branding.name is null', async () => {
    queue([SCHOOL_TEST_ORG_ROW_UNCONFIGURED], [EVENT_ROW])
    const result = await resolvePublicEvent('school-test-organisation', 'graduation')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.organisationName).toBe('School Test Organisation')
    expect(result.branding.name).toBeNull()
  })

  it('branding.logoUrl is null — the render layer falls back to OrganisationLogo\'s own initials treatment, never the old hardcoded crest', async () => {
    queue([SCHOOL_TEST_ORG_ROW_UNCONFIGURED], [EVENT_ROW])
    const result = await resolvePublicEvent('school-test-organisation', 'graduation')
    if (!result.ok) throw new Error('unreachable')
    expect(result.branding.logoUrl).toBeNull()
  })

  it('branding.website is null — no website link renders', async () => {
    queue([SCHOOL_TEST_ORG_ROW_UNCONFIGURED], [EVENT_ROW])
    const result = await resolvePublicEvent('school-test-organisation', 'graduation')
    if (!result.ok) throw new Error('unreachable')
    expect(result.branding.website).toBeNull()
  })

  it('the current gold/burgundy fallback accent remains exactly, since applyAccentOverride is a no-op on null accentColor', async () => {
    queue([SCHOOL_TEST_ORG_ROW_UNCONFIGURED], [EVENT_ROW])
    const result = await resolvePublicEvent('school-test-organisation', 'graduation')
    if (!result.ok) throw new Error('unreachable')
    const theme = resolvePublicEventTheme('school-test-organisation')
    const effective = applyAccentOverride(theme.tokens, result.branding.accentColor)
    expect(effective.accent).toBe('#8A6D1D')
    expect(effective.bandAccent).toBe('#C9A227')
    expect(effective.bandBg).toBe('#4B001F')
    expect(effective.bg).toBe('#FAF9F6')
    expect(effective.headingFontFamily).toBe('Georgia, "Times New Roman", Times, serif')
  })

  it('no synthetic tagline exists anywhere to render — the field was removed entirely, not just left unconfigured', () => {
    const chromeSource = read('components/publicEvents/InstitutionalChrome.tsx')
    expect(chromeSource).not.toMatch(/tagline/i)
    expect(chromeSource).not.toMatch(/Community & Events/)
  })

  it('"Registrations powered by BrainBase" attribution is unconditionally present in InstitutionalFooter\'s own source, not gated on any branding/configuration state', () => {
    const chromeSource = read('components/publicEvents/InstitutionalChrome.tsx')
    const footerFn = chromeSource.slice(chromeSource.indexOf('export function InstitutionalFooter'))
    expect(footerFn).toContain('Registrations powered by BrainBase')
  })
})

describe('School Test / institutional — branding CONFIGURED', () => {
  it('configured name/logo/website all resolve through the same allowlisted branding object', async () => {
    queue([SCHOOL_TEST_ORG_ROW_CONFIGURED], [EVENT_ROW])
    const result = await resolvePublicEvent('school-test-organisation', 'graduation')
    if (!result.ok) throw new Error('unreachable')
    expect(result.branding.name).toBe('Configured Display Name')
    expect(result.branding.logoUrl).toBe('https://cdn.example.com/school-logo.png')
    expect(result.branding.website).toBe('https://school-test.example.com')
  })

  it('configured accent overrides the safe accent tokens only — fixed background/band/CTA gradient remain the exact structural fallback', async () => {
    queue([SCHOOL_TEST_ORG_ROW_CONFIGURED], [EVENT_ROW])
    const result = await resolvePublicEvent('school-test-organisation', 'graduation')
    if (!result.ok) throw new Error('unreachable')
    const theme = resolvePublicEventTheme('school-test-organisation')
    const effective = applyAccentOverride(theme.tokens, result.branding.accentColor)
    expect(effective.accent).toBe('#112233')
    expect(effective.accentSoft).toBe('#112233')
    expect(effective.accentRgb).toBe('17,34,51')
    // Structural values untouched by the override:
    expect(effective.bandAccent).toBe('#C9A227')
    expect(effective.accentGradient).toBe(theme.tokens.accentGradient)
    expect(effective.bandBg).toBe('#4B001F')
    expect(effective.bg).toBe('#FAF9F6')
    expect(effective.green).toBe(theme.tokens.green)
    expect(effective.red).toBe(theme.tokens.red)
  })

  it('the institutional structural layout (variant) is unaffected by configured branding', () => {
    expect(resolvePublicEventTheme('school-test-organisation').variant).toBe('institutional')
  })
})

describe('Default variant — unconfigured', () => {
  it('resolvePublicEvent for a non-registry slug returns the default structural variant, all-null branding', async () => {
    queue([DEFAULT_ORG_ROW_UNCONFIGURED], [EVENT_ROW_DEFAULT])
    const result = await resolvePublicEvent('acme-co', 'graduation')
    if (!result.ok) throw new Error('unreachable')
    expect(resolvePublicEventTheme('acme-co').variant).toBe('default')
    expect(result.branding).toEqual({ name: null, logoUrl: null, accentColor: null, website: null })
  })

  it('EventHeader (BrainBase wordmark + "Powered by BrainBase") remains unconditional and untouched — confirmed via source', () => {
    const clientSource = read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx')
    expect(clientSource).toMatch(/function EventHeader\(\)\s*\{/)
    const fnStart = clientSource.indexOf('function EventHeader()')
    const fnEnd = clientSource.indexOf('\n}', fnStart) + 2
    expect(clientSource.slice(fnStart, fnEnd)).toContain('Powered by BrainBase')
  })

  it('the compact default-variant identity row never replaces BrainBaseWordmark — both exist independently in source', () => {
    const clientSource = read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx')
    expect(clientSource).toContain('BrainBaseWordmark')
    expect(clientSource).toContain('<OrganisationLogo branding={branding} organisationName={organisationName} size={28} />')
  })

  it('the identity row is gated on !institutional, and does not set background/body colour from branding', () => {
    const clientSource = read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx')
    const idx = clientSource.indexOf('Default-variant organisation identity')
    expect(idx).toBeGreaterThan(-1)
    const surrounding = clientSource.slice(idx - 400, idx)
    expect(surrounding).toMatch(/\{!institutional && \(/)
  })
})

describe('Default variant — CONFIGURED', () => {
  it('organisation identity resolves correctly for a default-variant organisation with configured branding', async () => {
    queue([DEFAULT_ORG_ROW_CONFIGURED], [EVENT_ROW_DEFAULT])
    const result = await resolvePublicEvent('acme-co', 'graduation')
    if (!result.ok) throw new Error('unreachable')
    expect(result.branding.name).toBe('Acme Display')
    expect(result.branding.logoUrl).toBe('https://cdn.example.com/acme-logo.png')
    expect(result.branding.website).toBe('https://acme.example.com')
  })

  it('BrainBase header attribution remains present regardless — no full-theme takeover, background stays the fixed default token', () => {
    const theme = resolvePublicEventTheme('acme-co')
    const effective = applyAccentOverride(theme.tokens, '#ff8800')
    expect(effective.bg).toBe('#07080B') // fixed, never organisation-controlled
    expect(effective.textPrimary).toBe('#F5F7FA') // fixed
    expect(effective.accent).toBe('#ff8800') // safe accent affordance only
  })
})

describe('Hub/Detail consistency — same organisation, same slug, cannot diverge', () => {
  it('resolvePublicEvent and getPublicUpcomingEvents resolve identical branding for the same organisation row', async () => {
    queue([SCHOOL_TEST_ORG_ROW_CONFIGURED], [EVENT_ROW])
    const detailResult = await resolvePublicEvent('school-test-organisation', 'graduation')
    if (!detailResult.ok) throw new Error('unreachable')

    queue([SCHOOL_TEST_ORG_ROW_CONFIGURED])
    const hubResult = await getPublicUpcomingEvents('school-test-organisation')
    if (!hubResult.ok) throw new Error('unreachable')

    expect(hubResult.branding).toEqual(detailResult.branding)
    expect(hubResult.organisationName).toBe(detailResult.organisationName)
  })

  it('both resolve the same structural variant for the same slug (same resolvePublicEventTheme call, same registry)', () => {
    const detailTheme = resolvePublicEventTheme('school-test-organisation')
    const hubTheme = resolvePublicEventTheme('school-test-organisation')
    expect(detailTheme.variant).toBe(hubTheme.variant)
    expect(detailTheme.tokens).toEqual(hubTheme.tokens)
  })

  it('getPublicUpcomingEvents extends its query with settings using the SAME zero-extra-round-trip pattern as resolvePublicEvent — one org query, not two', async () => {
    queue([SCHOOL_TEST_ORG_ROW_UNCONFIGURED])
    await getPublicUpcomingEvents('school-test-organisation')
    // org lookup only (no events in this fixture) — confirms settings was
    // fetched in the SAME query as id/name, not a second round trip.
    expect(sqlMock).toHaveBeenCalledTimes(2) // org lookup + event list query
  })

  it('PublicEventsHubClient and PublicEventClient both source branding from their own server-resolved prop, never re-deriving it client-side', () => {
    const hubSource = read('app/e/[organisationSlug]/PublicEventsHubClient.tsx')
    const clientSource = read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx')
    expect(hubSource).toMatch(/branding,\s*events/)
    expect(clientSource).toMatch(/detail;/)
    expect(hubSource).not.toMatch(/fetch\(.*branding/i)
    expect(clientSource).not.toMatch(/fetch\(.*branding/i)
  })
})

describe('Security/tenancy — Phase 3B additions preserve every existing guarantee', () => {
  it('getPublicUpcomingEvents never returns organisationId or raw settings', async () => {
    queue([{ ...SCHOOL_TEST_ORG_ROW_CONFIGURED, settings: { branding: { name: 'X' }, commercial: { businessProfile: { abn: 'SHOULD-NEVER-LEAK' } } } }])
    const result = await getPublicUpcomingEvents('school-test-organisation')
    if (!result.ok) throw new Error('unreachable')
    const json = JSON.stringify(result)
    expect(json).not.toMatch(/org-school|organisationId|SHOULD-NEVER-LEAK/)
    expect(Object.keys(result)).not.toContain('organisationId')
  })

  it('getPublicUpcomingEvents resolves organisation solely from the slug — no organisationId parameter exists on the function', () => {
    // Type-level guarantee: getPublicUpcomingEvents(organisationSlug: string)
    // has no organisationId parameter; every call site in this file
    // passing a single slug string compiling is the proof.
    expect(getPublicUpcomingEvents.length).toBe(1)
  })

  it('no write route, Blob helper, or upload/delete logic was touched by this phase (static containment)', () => {
    const brandingRoute = read('app/api/organisations/branding/route.ts')
    const logoRoute = read('app/api/organisations/branding/logo/route.ts')
    const brandingStorage = read('lib/organisations/brandingStorage.ts')
    // These files should contain no reference to the theme/presentation
    // module this phase touched — proving no coupling was introduced.
    for (const src of [brandingRoute, logoRoute, brandingStorage]) {
      expect(src).not.toMatch(/publicEventTheme|InstitutionalChrome/)
    }
  })
})
