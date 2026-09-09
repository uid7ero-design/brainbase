import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase 3C — organisation branding applied to the shared TicketCard
// boundary (individual ticket /t/[token] and the booking wallet
// /b/[bookingToken]/tickets). Static source-text containment, not a
// claim of proven rendering behaviour — this repo has no jsdom/React
// Testing Library harness (see tennisSessionManagementUiStaticCheck
// .test.ts for the same caveat spelled out in full). Resolver-level
// (SQL-mocked) coverage — organisationName field, single-query
// discipline, cross-surface consistency between /t and /b — lives in
// ticketBookingOrganisationBranding.test.ts, a sibling of this file.

const root = path.resolve(__dirname, '../..')
function read(relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const cardSource = read('components/events/TicketCard.tsx')
const cardCode = stripComments(cardSource)
const ticketPageSource = read('app/t/[token]/page.tsx')
const walletPageSource = read('app/b/[bookingToken]/tickets/page.tsx')
const walletNavSource = read('app/b/[bookingToken]/tickets/BookingWalletNav.tsx')
const qrSource = read('lib/events/qr.ts')
const ticketValiditySource = read('lib/events/ticketValidity.ts')

describe('TicketCard — shared boundary, not duplicated per route', () => {
  it('TicketCard is the only ticket/wallet component that imports OrganisationLogo', () => {
    expect(cardSource).toContain("import { OrganisationLogo } from '@/components/organisations/OrganisationLogo'")
    for (const src of [ticketPageSource, walletPageSource, walletNavSource]) {
      expect(src).not.toMatch(/OrganisationLogo/)
    }
  })

  it('no separate IndividualBrandedTicketCard/BookingBrandedTicketCard or other duplicate branding renderer exists anywhere', () => {
    for (const src of [cardSource, ticketPageSource, walletPageSource, walletNavSource]) {
      expect(src).not.toMatch(/BrandedTicketCard|IndividualBrandedTicketCard|BookingBrandedTicketCard/)
    }
  })

  it('TicketCardProps carries branding/organisationName as optional fields, both independently nullable/omittable', () => {
    const propsStart = cardCode.indexOf('export type TicketCardProps = {')
    const propsEnd = cardCode.indexOf('\n};', propsStart)
    const propsBlock = cardCode.slice(propsStart, propsEnd)
    expect(propsBlock).toMatch(/branding\?:\s*PublicOrganisationBranding\s*\|\s*null/)
    expect(propsBlock).toMatch(/organisationName\?:\s*string/)
  })
})

describe('Unconfigured branding — visually equivalent to pre-3C, except the approved identity region', () => {
  it('the identity region only renders when organisationName is truthy — a caller that omits it renders nothing new at all', () => {
    expect(cardCode).toMatch(/\{organisationName && \(/)
  })

  it('no website link renders unless branding.website is itself configured (never invented)', () => {
    expect(cardCode).toMatch(/\{branding\?\.website && \(/)
  })

  it('the divider falls back to the existing structural TICKET_BORDER colour, never a decorative violet, when accentColor is null', () => {
    expect(cardCode).toMatch(/const dividerColor = branding\?\.accentColor \?\? TICKET_BORDER;/)
  })

  it('the display name falls back to organisationName only when branding.name is null — never a slug, never invented', () => {
    expect(cardCode).toMatch(/\{branding\?\.name \?\? organisationName\}/)
  })
})

describe('Configured branding — approved decorative accent scope only', () => {
  it('accentColor is read in exactly two places: the identity-region divider and the website link colour', () => {
    const accentReads = cardCode.match(/branding\?\.accentColor/g) ?? []
    expect(accentReads.length).toBe(2)
  })

  it('accentColor never appears near the QR block', () => {
    const qrBlockStart = cardCode.indexOf('aria-label={`Ticket QR code')
    const qrBlockEnd = cardCode.indexOf('</div>', qrBlockStart) // this specific QR container's own closing tag
    const qrBlock = cardCode.slice(Math.max(0, qrBlockStart - 200), qrBlockEnd)
    expect(qrBlock).not.toMatch(/accentColor|dividerColor|linkColor/)
  })

  it('accentColor never appears near the checked-in/valid status badges', () => {
    const statusStart = cardCode.indexOf('checkedInAt ?')
    const statusEnd = cardCode.indexOf('function TicketField', statusStart)
    const statusBlock = cardCode.slice(statusStart, statusEnd)
    expect(statusBlock).not.toMatch(/accentColor|dividerColor|linkColor/)
  })

  it('accentColor never appears near the cancelled/event-cancelled message', () => {
    const cancelledStart = cardCode.indexOf('cancelled ? (')
    const cancelledEnd = cardCode.indexOf(') : (', cancelledStart)
    const cancelledBlock = cardCode.slice(cancelledStart, cancelledEnd)
    expect(cancelledBlock).not.toMatch(/accentColor|dividerColor|linkColor/)
  })
})

describe('QR invariant — non-negotiable', () => {
  it('lib/events/qr.ts is byte-identical in its colour contract: dark #0B0B12, light #FFFFFF, never organisation-controlled', () => {
    expect(qrSource).toContain("color: { dark: '#0B0B12', light: '#FFFFFF' }")
  })

  it('TicketCard never imports lib/events/qr.ts — it only ever receives an opaque, already-rendered qrSvg string', () => {
    expect(cardSource).not.toMatch(/from ['"]@\/lib\/events\/qr['"]/)
    expect(cardSource).not.toMatch(/generateTicketQrSvg|buildTicketUrl/)
  })

  it('the QR container background stays the fixed literal #fff, never a branding-derived colour', () => {
    expect(cardCode).toContain("background: '#fff'")
  })

  it('neither /t nor /b page passes branding into qr generation — generateTicketQrSvg is called with only a URL string, both before and after this pass', () => {
    for (const src of [ticketPageSource, walletPageSource]) {
      const callSites = src.match(/generateTicketQrSvg\([^)]*\)/g) ?? []
      expect(callSites.length).toBeGreaterThan(0)
      for (const call of callSites) {
        expect(call).not.toMatch(/branding|accentColor/)
      }
    }
  })
})

describe('Status/validity invariant — semantics untouched by branding', () => {
  it('ticketValidity.ts is completely untouched by this pass (no branding import, no accent concept)', () => {
    expect(ticketValiditySource).not.toMatch(/branding|accentColor|organisation/i)
  })

  it('TICKET_GREEN/TICKET_RED remain fixed literals, never derived from branding', () => {
    expect(cardCode).toContain("export const TICKET_GREEN = '#4ADE80';")
    expect(cardCode).toContain("export const TICKET_RED = '#F87171';")
    expect(cardCode).not.toMatch(/TICKET_GREEN\s*=\s*branding|TICKET_RED\s*=\s*branding/)
  })

  it('status branching (cancelled/eventCancelled/checkedInAt) is derived only from props.status/props.checkedInAt, never from branding', () => {
    expect(cardCode).toContain("const cancelled = props.status !== 'VALID';")
    expect(cardCode).toContain("const eventCancelled = props.status === 'EVENT_CANCELLED';")
  })
})

describe('No raw/private branding fields ever referenced', () => {
  it('TicketCard never references organisationId or any raw settings/private branding field', () => {
    expect(cardCode).not.toMatch(/organisationId|organisation_id|\.email\b|\.phone\b|\.address\b|\.abn\b|emailFooter|emailSenderName/)
  })

  it('the page/nav wiring files never reference organisationId or raw settings either', () => {
    for (const src of [ticketPageSource, walletPageSource, walletNavSource]) {
      const code = stripComments(src)
      expect(code).not.toMatch(/organisationId|organisation_id|organisation_settings/)
    }
  })
})

describe('Individual ticket page (/t/[token]) — wiring only, no new query, no scope creep', () => {
  it('threads detail.branding and detail.organisationName straight into TicketCard, no re-query', () => {
    expect(ticketPageSource).toContain('branding={detail.branding}')
    expect(ticketPageSource).toContain('organisationName={detail.organisationName}')
    expect(ticketPageSource).not.toMatch(/getPublicOrganisationBranding|getOrganisationBranding/)
  })

  it('still calls getPublicTicketDetail exactly once, exactly as before this pass', () => {
    const occurrences = (ticketPageSource.match(/getPublicTicketDetail\(/g) ?? []).length
    expect(occurrences).toBe(2) // generateMetadata + the page body — unchanged from pre-3C
  })

  it('"Powered by BrainBase" attribution is unchanged', () => {
    expect(ticketPageSource).toContain('Powered by BrainBase')
  })

  it('no sibling-ticket navigation was added to the individual ticket page', () => {
    const code = stripComments(ticketPageSource)
    expect(code).not.toMatch(/Previous|Next ›|BookingWalletNav/)
  })
})

describe('Booking wallet (/b/[bookingToken]/tickets) — wiring only, all attendees share one resolved branding object', () => {
  it('threads detail.branding/detail.organisationName into both the 1-attendee TicketCard call and BookingWalletNav', () => {
    const singleBranchStart = walletPageSource.indexOf('tickets.length === 1 ? (')
    const singleBranchEnd = walletPageSource.indexOf(') : (', singleBranchStart)
    const singleBranch = walletPageSource.slice(singleBranchStart, singleBranchEnd)
    expect(singleBranch).toContain('branding={detail.branding}')
    expect(singleBranch).toContain('organisationName={detail.organisationName}')

    const navCallStart = walletPageSource.indexOf('<BookingWalletNav')
    const navCallEnd = walletPageSource.indexOf('/>', navCallStart)
    const navCall = walletPageSource.slice(navCallStart, navCallEnd)
    expect(navCall).toContain('branding={detail.branding}')
    expect(navCall).toContain('organisationName={detail.organisationName}')
  })

  it('branding is resolved once at the booking/order level (getPublicBookingDetail), never per attendee', () => {
    const code = stripComments(walletPageSource)
    const occurrences = (code.match(/getPublicBookingDetail\(/g) ?? []).length
    expect(occurrences).toBe(2) // generateMetadata + the page body — unchanged from pre-3C
  })

  it('"Powered by BrainBase" attribution is unchanged', () => {
    expect(walletPageSource).toContain('Powered by BrainBase')
  })
})

describe('BookingWalletNav — forwards branding to its single TicketCard call, own navigation chrome stays unbranded (smaller-change option)', () => {
  it('accepts branding/organisationName as optional props and forwards them into its one TicketCard call', () => {
    expect(walletNavSource).toMatch(/branding\?:\s*PublicOrganisationBranding\s*\|\s*null/)
    expect(walletNavSource).toMatch(/organisationName\?:\s*string/)
    const cardCallStart = walletNavSource.indexOf('<TicketCard')
    const cardCallEnd = walletNavSource.indexOf('/>', cardCallStart)
    const cardCall = walletNavSource.slice(cardCallStart, cardCallEnd)
    expect(cardCall).toContain('branding={branding}')
    expect(cardCall).toContain('organisationName={organisationName}')
  })

  it('still renders exactly one <TicketCard> call site, driven by a single current index — one QR at a time preserved', () => {
    const occurrences = (walletNavSource.match(/<TicketCard/g) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('the attendee chip strip, jump <select>, and Previous/Next buttons never reference branding/accentColor — deliberately left on the existing TICKET_* structural constants', () => {
    const chipStyleStart = walletNavSource.indexOf('const chipStyle')
    const chipStyleEnd = walletNavSource.indexOf('\n});', chipStyleStart) + 4
    const navBtnStart = walletNavSource.indexOf('const navBtnStyle')
    const navBtnEnd = walletNavSource.indexOf('\n};', navBtnStart) + 3
    for (const block of [walletNavSource.slice(chipStyleStart, chipStyleEnd), walletNavSource.slice(navBtnStart, navBtnEnd)]) {
      expect(block).not.toMatch(/branding|accentColor/)
    }
  })
})

describe('Accessibility / layout', () => {
  it('the identity-region organisation name truncates safely (ellipsis, no-wrap) rather than breaking layout for a long name', () => {
    const identityStart = cardCode.indexOf('{organisationName && (')
    const identityEnd = cardCode.indexOf(')}', cardCode.indexOf('eventArtworkUrl'))
    const identityBlock = cardCode.slice(identityStart, identityEnd)
    expect(identityBlock).toMatch(/overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'/)
  })

  it('the organisation logo uses a bounded, modest size (not full-width, not competing with event artwork)', () => {
    expect(cardCode).toMatch(/<OrganisationLogo branding=\{branding\} organisationName=\{organisationName\} size=\{28\} \/>/)
  })

  it('Previous/Next controls remain real buttons with ~44px minimum tap targets (unchanged by this pass)', () => {
    expect(walletNavSource).toMatch(/minWidth: 44, minHeight: 44/)
  })
})
