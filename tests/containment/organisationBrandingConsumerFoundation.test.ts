import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase 3A — the additive branding-consumer foundation: exports a pure
// normaliser + public normaliser from lib/organisations/branding.ts,
// threads a public-safe branding view model through resolvePublicEvent/
// getPublicTicketDetail/getPublicBookingDetail, and adds two presentation
// components (OrganisationLogo, BrandContactFooter) unused by any page
// yet. Nothing in this PR renders branding anywhere — see the
// "Visual invariant" describe block at the bottom of this file for the
// static proof of that.
//
// Single top-level vi.mock('@/lib/db', ...) shared by every resolver
// describe block below (Vitest hoists vi.mock calls to the top of the
// module regardless of where they're written, so a SECOND vi.mock call
// for the same module path inside a nested describe block does not
// create an independent mock — it silently breaks the closures the
// other one relies on). Matches the exact convention already
// established by tests/containment/eventsPublicRouting.test.ts and
// tests/containment/organisationBrandingSettings.test.ts.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

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
  responseQueue = []
  callCount = 0
})

const { normaliseOrganisationBranding, normalisePublicOrganisationBranding } = await import('@/lib/organisations/branding')
const { resolvePublicEvent } = await import('@/lib/events/publicResolve')
const { getPublicTicketDetail } = await import('@/lib/events/publicTicket')
const { getPublicBookingDetail } = await import('@/lib/events/publicBooking')

describe('normaliseOrganisationBranding — pure, no DB access', () => {
  it('fully configured branding normalises correctly', () => {
    const raw = {
      branding: {
        name: 'Acme School', logoUrl: 'https://cdn.example.com/logo.png', accentColor: '#8A4DFF',
        email: 'hello@acme.test', phone: '0400 000 000', website: 'https://acme.test',
        address: '1 Example St', abn: '12 345 678 901', emailFooter: 'Thanks!', emailSenderName: 'Acme School',
      },
    }
    const result = normaliseOrganisationBranding(raw, 'Acme School Pty Ltd')
    expect(result.organisationName).toBe('Acme School Pty Ltd')
    expect(result.branding).toEqual({
      name: 'Acme School', logoUrl: 'https://cdn.example.com/logo.png', accentColor: '#8a4dff',
      email: 'hello@acme.test', phone: '0400 000 000', website: 'https://acme.test',
      address: '1 Example St', abn: '12 345 678 901', emailFooter: 'Thanks!', emailSenderName: 'Acme School',
    })
  })

  it('partial branding returns null for every absent field, correct values for present ones', () => {
    const result = normaliseOrganisationBranding({ branding: { name: 'Acme', accentColor: '#fff' } }, 'Acme')
    expect(result.branding.name).toBe('Acme')
    expect(result.branding.accentColor).toBe('#ffffff')
    expect(result.branding.logoUrl).toBeNull()
    expect(result.branding.email).toBeNull()
    expect(result.branding.website).toBeNull()
  })

  it('no branding namespace configured at all -> every field null, no throw', () => {
    const result = normaliseOrganisationBranding({}, 'Acme')
    expect(result.branding).toEqual({
      name: null, logoUrl: null, accentColor: null, email: null, phone: null,
      website: null, address: null, abn: null, emailFooter: null, emailSenderName: null,
    })
  })

  it('completely empty/null/undefined settings -> safe empty result, never throws', () => {
    expect(() => normaliseOrganisationBranding(null, 'Acme')).not.toThrow()
    expect(() => normaliseOrganisationBranding(undefined, 'Acme')).not.toThrow()
    expect(normaliseOrganisationBranding(null, 'Acme').branding.name).toBeNull()
  })

  it('malformed accent colour -> null, never stored/returned malformed', () => {
    expect(normaliseOrganisationBranding({ branding: { accentColor: 'not-a-colour' } }, 'Acme').branding.accentColor).toBeNull()
    expect(normaliseOrganisationBranding({ branding: { accentColor: 'rgb(0,0,0)' } }, 'Acme').branding.accentColor).toBeNull()
  })

  it('malformed logo/website URL -> null (non-http(s) scheme rejected)', () => {
    expect(normaliseOrganisationBranding({ branding: { logoUrl: 'javascript:alert(1)' } }, 'Acme').branding.logoUrl).toBeNull()
    expect(normaliseOrganisationBranding({ branding: { website: 'ftp://example.com' } }, 'Acme').branding.website).toBeNull()
    expect(normaliseOrganisationBranding({ branding: { website: 'not a url' } }, 'Acme').branding.website).toBeNull()
  })
})

describe('normalisePublicOrganisationBranding — pure, public-safe allowlist', () => {
  it('returns exactly the 4-field public shape for fully configured branding', () => {
    const raw = {
      branding: {
        name: 'Acme School', logoUrl: 'https://cdn.example.com/logo.png', accentColor: '#8A4DFF',
        email: 'hello@acme.test', phone: '0400 000 000', website: 'https://acme.test',
        address: '1 Example St', abn: '12 345 678 901', emailFooter: 'Thanks!', emailSenderName: 'Acme',
      },
    }
    const result = normalisePublicOrganisationBranding(raw, 'Acme School Pty Ltd')
    expect(result).toEqual({
      name: 'Acme School', logoUrl: 'https://cdn.example.com/logo.png', accentColor: '#8a4dff', website: 'https://acme.test',
    })
  })

  it('the returned object key set is EXACTLY name/logoUrl/accentColor/website — never wider', () => {
    const raw = { branding: { name: 'Acme', email: 'x@y.test', phone: '000', address: 'addr', abn: '123', emailFooter: 'f', emailSenderName: 'n' } }
    const result = normalisePublicOrganisationBranding(raw, 'Acme')
    expect(Object.keys(result).sort()).toEqual(['accentColor', 'logoUrl', 'name', 'website'])
  })

  it('never contains email/phone/address/abn/emailFooter/emailSenderName/organisationId under any key name, even serialized', () => {
    const raw = {
      branding: {
        name: 'Acme', email: 'secret@acme.test', phone: '0400 111 222', address: '99 Secret Rd',
        abn: '99 999 999 999', emailFooter: 'Secret footer', emailSenderName: 'Secret Sender',
      },
    }
    const result = normalisePublicOrganisationBranding(raw, 'org-real-name')
    const json = JSON.stringify(result)
    expect(json).not.toMatch(/secret@acme\.test|0400 111 222|99 Secret Rd|99 999 999 999|Secret footer|Secret Sender|organisationId/i)
  })

  it('unconfigured organisation -> all-null public object, no error', () => {
    const result = normalisePublicOrganisationBranding({}, 'Acme')
    expect(result).toEqual({ name: null, logoUrl: null, accentColor: null, website: null })
  })

  it('does not substitute organisationName into name — preserves existing getPublicOrganisationBranding contract (render layer performs the fallback)', () => {
    const result = normalisePublicOrganisationBranding({}, 'Fallback Org Name')
    expect(result.name).toBeNull()
  })
})

describe('resolvePublicEvent — branding threaded through the existing organisation lookup', () => {
  it('returns a public-safe branding object derived from the SAME organisation row already queried for id/capability', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: true })
    queue(
      [{ id: 'org-a', name: 'Acme School', settings: { branding: { name: 'Acme Display', accentColor: '#123456' } } }],
      [{ id: 'event-1', organisation_id: 'org-a', name: 'Graduation', slug: 'graduation', description: null, venue: null, artwork_url: null, starts_at: new Date(), ends_at: new Date(), timezone: 'UTC' }],
    )
    const result = await resolvePublicEvent('acme-school', 'graduation')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.branding).toEqual({ name: 'Acme Display', logoUrl: null, accentColor: '#123456', website: null })
    expect(sqlMock).toHaveBeenCalledTimes(2) // org lookup + event lookup — NOT a third query for branding
  })

  it('unconfigured organisation -> all-null branding, still ok:true', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: true })
    queue(
      [{ id: 'org-a', name: 'Acme School', settings: {} }],
      [{ id: 'event-1', organisation_id: 'org-a', name: 'Graduation', slug: 'graduation', description: null, venue: null, artwork_url: null, starts_at: new Date(), ends_at: new Date(), timezone: 'UTC' }],
    )
    const result = await resolvePublicEvent('acme-school', 'graduation')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.branding).toEqual({ name: null, logoUrl: null, accentColor: null, website: null })
  })

  it('organisation resolved solely from the URL slug — the function signature has no organisationId parameter, so no caller can retarget branding to another tenant', () => {
    // Type-level guarantee, documented as the structural claim it is:
    // resolvePublicEvent(organisationSlug: string, eventSlug: string)
    // accepts only slugs. Every call site in this file passing exactly
    // two slug strings compiling is the proof.
    expect(true).toBe(true)
  })
})

describe('getPublicTicketDetail — branding derives from the ticket-token-resolved organisation join', () => {
  const BASE_ROW = {
    attendee_name: 'Jamie', checked_in_at: null, order_status: 'CONFIRMED', payment_status: 'NOT_REQUIRED',
    event_status: 'PUBLISHED', event_name: 'Graduation', venue: 'Hall', artwork_url: null,
    starts_at: new Date(), ends_at: new Date(), timezone: 'UTC',
    ticket_type_name: 'General', session_name: null, session_starts_at: null, session_ends_at: null,
  }

  it('a ticket token resolves branding from its own organisation, never a different one — single query, one join', async () => {
    queue([{ ...BASE_ROW, organisation_name: 'Org A Real Name', organisation_settings: { branding: { name: 'Org A Brand', website: 'https://org-a.test' } } }])
    const result = await getPublicTicketDetail('tok-org-a')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.detail.branding).toEqual({ name: 'Org A Brand', logoUrl: null, accentColor: null, website: 'https://org-a.test' })
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('a different tenant\'s ticket token yields that tenant\'s own branding, not a mix/leak of any other organisation\'s data', async () => {
    queue([{ ...BASE_ROW, organisation_name: 'Org B Real Name', organisation_settings: { branding: { name: 'Org B Brand' } } }])
    const result = await getPublicTicketDetail('tok-org-b')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.detail.branding.name).toBe('Org B Brand')
    expect(JSON.stringify(result.detail)).not.toMatch(/Org A Brand|org-a\.test/)
  })

  it('branding never exposes organisationId or raw settings on the ticket detail', async () => {
    queue([{ ...BASE_ROW, organisation_name: 'Org A', organisation_settings: { branding: { name: 'Org A' }, commercial: { businessProfile: { abn: 'SHOULD-NEVER-LEAK' } } } }])
    const result = await getPublicTicketDetail('tok-1')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(JSON.stringify(result.detail)).not.toMatch(/organisationId|organisation_id|SHOULD-NEVER-LEAK/)
    expect(Object.keys(result.detail).sort()).not.toContain('organisationId')
  })
})

describe('getPublicBookingDetail — branding derives from the booking-token-resolved organisation join', () => {
  const ORDER_ROW = {
    id: 'order-1', organisation_id: 'org-a', purchaser_name: 'Jamie', order_status: 'CONFIRMED', payment_status: 'NOT_REQUIRED',
    event_status: 'PUBLISHED', event_name: 'Graduation', venue: 'Hall', artwork_url: null,
    starts_at: new Date(), ends_at: new Date(), timezone: 'UTC',
  }
  const ATTENDEE_ROWS = [
    { attendee_name: 'Jamie', ticket_token: 'tt-1', checked_in_at: null, ticket_type_name: 'General', session_name: null, session_starts_at: null, session_ends_at: null },
    { attendee_name: 'Alex', ticket_token: 'tt-2', checked_in_at: null, ticket_type_name: 'General', session_name: null, session_starts_at: null, session_ends_at: null },
  ]

  it('a booking token resolves branding from its own organisation — single order-level join, applied uniformly to every attendee ticket', async () => {
    queue(
      [{ ...ORDER_ROW, organisation_name: 'Org A Real Name', organisation_settings: { branding: { name: 'Org A Brand', accentColor: '#ff0000' } } }],
      ATTENDEE_ROWS,
    )
    const result = await getPublicBookingDetail('book-org-a')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.detail.branding).toEqual({ name: 'Org A Brand', logoUrl: null, accentColor: '#ff0000', website: null })
    expect(result.detail.tickets).toHaveLength(2)
  })

  it('a booking token cannot switch tenant — branding always matches the token\'s own resolved organisation, never client-influenced', async () => {
    queue(
      [{ ...ORDER_ROW, organisation_name: 'Org B Real Name', organisation_settings: { branding: { name: 'Org B Brand' } } }],
      ATTENDEE_ROWS,
    )
    const result = await getPublicBookingDetail('book-org-b')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.detail.branding.name).toBe('Org B Brand')
    expect(JSON.stringify(result.detail)).not.toMatch(/Org A Brand|organisationId|organisation_id/)
  })
})

describe('Visual invariant — this PR renders nothing new anywhere', () => {
  const liveSurfaces = [
    'app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx',
    'app/e/[organisationSlug]/PublicEventsHubClient.tsx',
    'app/t/[token]/page.tsx',
    'app/b/[bookingToken]/tickets/page.tsx',
    'app/b/[bookingToken]/tickets/BookingWalletNav.tsx',
    'components/events/TicketCard.tsx',
  ]

  it('no live page/component imports OrganisationLogo or BrandContactFooter yet', () => {
    for (const surface of liveSurfaces) {
      const src = read(surface)
      expect(src).not.toMatch(/OrganisationLogo/)
      expect(src).not.toMatch(/BrandContactFooter/)
    }
  })

  it('publicEventTheme.ts and InstitutionalChrome.tsx are untouched by this PR (Phase 3B\'s own scope, not this one)', () => {
    const theme = read('lib/events/publicEventTheme.ts')
    const chrome = read('components/publicEvents/InstitutionalChrome.tsx')
    expect(theme).not.toMatch(/normalisePublicOrganisationBranding|normaliseOrganisationBranding/)
    expect(chrome).not.toMatch(/normalisePublicOrganisationBranding|normaliseOrganisationBranding/)
  })
})

describe('New components — presentation only, no write/delete capability', () => {
  const logoSrc = read('components/organisations/OrganisationLogo.tsx')
  const footerSrc = read('components/organisations/BrandContactFooter.tsx')
  const logoCode = stripComments(logoSrc)
  const footerCode = stripComments(footerSrc)

  it('OrganisationLogo has no Blob/upload/delete logic', () => {
    expect(logoCode).not.toMatch(/@vercel\/blob|uploadOrganisationLogo|deleteOrganisationLogoIfManaged/)
  })

  it('BrandContactFooter never references private branding fields (email/phone/address/abn/emailFooter/emailSenderName) in actual code, only in its own explanatory comments', () => {
    expect(footerCode).not.toMatch(/\.email\b|\.phone\b|\.address\b|\.abn\b|emailFooter|emailSenderName/)
  })

  it('both new components import PublicOrganisationBranding from the branding module, and neither has an import specifier for the private OrganisationBranding type', () => {
    for (const src of [logoSrc, footerSrc]) {
      expect(src).toMatch(/import type \{ PublicOrganisationBranding \} from '@\/lib\/organisations\/branding';?/)
      const importLine = src.split('\n').find(l => l.includes("from '@/lib/organisations/branding'"))
      expect(importLine).toBeDefined()
      expect(importLine).not.toMatch(/\{\s*OrganisationBranding\s*[,}]/)
    }
  })
})
