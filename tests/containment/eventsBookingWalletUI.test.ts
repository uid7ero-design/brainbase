import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Booking wallet page/navigation — presentation and accessibility
// containment. Static source-text assertion, not a claim of proven
// rendering behaviour — this project has no jsdom/React Testing
// Library harness (see tennisSessionManagementUiStaticCheck.test.ts
// for the same caveat spelled out in full).

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const pageSource = stripComments(read('app/b/[bookingToken]/tickets/page.tsx'))
const navSource = stripComments(read('app/b/[bookingToken]/tickets/BookingWalletNav.tsx'))

describe('No simultaneous multi-QR mode — one QR at a time, no opt-in "show all"', () => {
  it('BookingWalletNav renders exactly one <TicketCard> call site, driven by a single current index', () => {
    const occurrences = (navSource.match(/<TicketCard/g) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('there is no map()/loop that renders a TicketCard per ticket — only per-attendee chips (name only, no QR) are ever mapped', () => {
    // The only .map( over `tickets` in the nav component must be the
    // chip-strip / <select> option list, never a card render.
    const mapCalls = navSource.match(/tickets\.map\([\s\S]*?\}/g) ?? []
    for (const call of mapCalls) {
      expect(call).not.toContain('<TicketCard')
      expect(call).not.toContain('qrSvg')
    }
  })

  it('no "show all" toggle/state exists anywhere in the nav component or the page', () => {
    expect(navSource).not.toMatch(/showAll/i)
    expect(pageSource).not.toMatch(/showAll/i)
  })

  it('the 1-attendee page branch renders TicketCard directly, also exactly once, with no navigator', () => {
    const singleBranchStart = pageSource.indexOf("tickets.length === 1 ? (")
    const singleBranchEnd = pageSource.indexOf(') : (', singleBranchStart)
    const branch = pageSource.slice(singleBranchStart, singleBranchEnd)
    expect((branch.match(/<TicketCard/g) ?? []).length).toBe(1)
    expect(branch).not.toContain('BookingWalletNav')
  })
})

describe('Navigator visibility — hidden for 1 attendee, visible for >1', () => {
  it('page.tsx branches explicitly on tickets.length === 1 vs the multi-attendee BookingWalletNav', () => {
    expect(pageSource).toMatch(/tickets\.length === 1/)
    expect(pageSource).toMatch(/<BookingWalletNav/)
  })

  it('BookingWalletNav itself also gates the count/chip-strip/Previous-Next UI on total > 1 — defence in depth even if ever mounted with one ticket', () => {
    const occurrences = (navSource.match(/total > 1/g) ?? []).length
    expect(occurrences).toBeGreaterThanOrEqual(2) // count/chip block + Previous/Next block
  })

  it('"no unnecessary wallet-specific clutter" for 1 attendee — the single-ticket branch has no chip strip, no Previous/Next, no attendee picker', () => {
    const singleBranchStart = pageSource.indexOf("tickets.length === 1 ? (")
    const singleBranchEnd = pageSource.indexOf(') : (', singleBranchStart)
    const branch = pageSource.slice(singleBranchStart, singleBranchEnd)
    expect(branch).not.toMatch(/Previous|Next ›|role="tablist"/)
  })
})

describe('Previous/Next controls', () => {
  it('real <button> elements, not clickable divs', () => {
    expect(navSource).toMatch(/<button onClick=\{goPrev\}/)
    expect(navSource).toMatch(/<button onClick=\{goNext\}/)
  })

  it('minimum ~44px tap targets', () => {
    expect(navSource).toMatch(/minWidth: 44, minHeight: 44/)
  })

  it('keyboard support — ArrowLeft/ArrowRight wired to the same goPrev/goNext handlers as the buttons', () => {
    expect(navSource).toMatch(/ArrowLeft/)
    expect(navSource).toMatch(/ArrowRight/)
    expect(navSource).toMatch(/goPrev\(\)/)
    expect(navSource).toMatch(/goNext\(\)/)
  })

  it('swipe is an additive enhancement (onTouchStart/onTouchEnd), never the only way to navigate', () => {
    expect(navSource).toMatch(/onTouchStart/)
    expect(navSource).toMatch(/onTouchEnd/)
    // Buttons must still exist independently of the touch handlers.
    expect(navSource).toMatch(/aria-label="Previous ticket"/)
    expect(navSource).toMatch(/aria-label="Next ticket"/)
  })

  it('no CSS transition/animation on ticket swap — instant swap only', () => {
    expect(navSource).not.toMatch(/transition:/)
    expect(navSource).not.toMatch(/@keyframes/)
    expect(navSource).not.toMatch(/animation:/)
  })
})

describe('Attendee jump strip and 10+ picker', () => {
  it('chip strip is the only horizontally-scrollable element (overflowX: auto)', () => {
    expect(navSource).toMatch(/overflowX: 'auto'/)
    const overflowCount = (navSource.match(/overflowX/g) ?? []).length
    expect(overflowCount).toBe(1)
  })

  it('chips carry accessible labels and selected state', () => {
    expect(navSource).toMatch(/aria-label=\{`Show ticket for \$\{t\.attendeeName\}`\}/)
    expect(navSource).toMatch(/aria-selected=\{i === index\}/)
    expect(navSource).toMatch(/role="tab"/)
    expect(navSource).toMatch(/role="tablist"/)
  })

  it('10+ attendees get an additional native <select> direct-jump control, gated on total >= 10', () => {
    expect(navSource).toMatch(/total >= 10/)
    expect(navSource).toMatch(/<select/)
  })
})

describe('QR aria-label includes the attendee name', () => {
  it('TicketCard\'s aria-label is parameterised by attendeeName, not a bare generic label', () => {
    const cardSource = stripComments(read('components/events/TicketCard.tsx'))
    expect(cardSource).toMatch(/aria-label=\{`Ticket QR code for \$\{props\.attendeeName\}`\}/)
  })
})

describe('No horizontal page overflow', () => {
  it('the page-level wrapper div never sets overflowX/overflow-x itself (only the chip strip does, scoped to itself)', () => {
    expect(pageSource).not.toMatch(/overflowX/)
    expect(pageSource).not.toMatch(/overflow-x/)
  })

  it('the wallet page reuses the same maxWidth: 420, centred container convention as /t/[token] — no wider fixed-width element that could force horizontal scroll', () => {
    expect(pageSource).toMatch(/maxWidth: 420/)
  })
})

describe('Individual sharing controls on each ticket', () => {
  it('"Open individual ticket" and "Copy link" are present for the multi-attendee nav', () => {
    expect(navSource).toContain('Open individual ticket')
    expect(navSource).toContain('Copy link')
  })

  it('the 1-attendee page branch also offers an individual ticket link', () => {
    expect(pageSource).toContain('Open individual ticket link')
  })

  it('individual ticket links use the existing /t/<token> shape via buildTicketUrl — never a new URL convention', () => {
    expect(pageSource).toMatch(/buildTicketUrl\(origin, t\.ticket_token\)/)
  })
})

describe('No client-side data fetching — sensitive resolution stays server-side', () => {
  it('BookingWalletNav ("use client") contains no fetch()/XHR call of any kind', () => {
    expect(navSource).toMatch(/^'use client';/)
    expect(navSource).not.toMatch(/fetch\(/)
  })

  it('page.tsx resolves the entire ticket set once, server-side, before any client component mounts', () => {
    expect(pageSource).toMatch(/await getPublicBookingDetail\(bookingToken\)/)
    expect(pageSource).toMatch(/await Promise\.all\(/)
  })
})

describe('Middleware — /b is public, alongside /e and /t, without broadening staff routes', () => {
  it('middleware.ts adds \'/b\' to PUBLIC', () => {
    const code = stripComments(read('middleware.ts'))
    expect(code).toMatch(/'\/b',/)
  })

  it('does not add \'/events\' (the staff management prefix) to PUBLIC', () => {
    const code = stripComments(read('middleware.ts'))
    const publicArrayStart = code.indexOf('const PUBLIC = [')
    const publicArrayEnd = code.indexOf('];', publicArrayStart)
    const publicArray = code.slice(publicArrayStart, publicArrayEnd)
    expect(publicArray).not.toMatch(/'\/events'/)
  })
})

describe('Rate limiting — /t and /b protected consistently', () => {
  it('app/t/[token]/page.tsx calls checkRateLimit with the same limit/window as the public JSON sibling', () => {
    const code = stripComments(read('app/t/[token]/page.tsx'))
    expect(code).toMatch(/checkRateLimit\(`public-ticket-lookup:\$\{ip\}`, 60, 60 \* 60_000\)/)
  })

  it('app/b/[bookingToken]/tickets/page.tsx calls checkRateLimit with an equivalent limit/window, distinct key prefix', () => {
    expect(pageSource).toMatch(/checkRateLimit\(`public-booking-lookup:\$\{ip\}`, 60, 60 \* 60_000\)/)
  })

  it('both are keyed by IP, never by the token itself — avoids a token-targeted rate-limit side channel', () => {
    const ticketCode = stripComments(read('app/t/[token]/page.tsx'))
    expect(ticketCode).toMatch(/getClientIp/)
    expect(pageSource).toMatch(/getClientIp/)
  })

  it('normal wallet navigation (Previous/Next/chip taps) triggers zero additional server requests, so a family switching quickly between tickets cannot be blocked by this limit', () => {
    // The entire ticket set — including every QR SVG — is resolved once
    // in page.tsx; BookingWalletNav only ever mutates local `index`
    // state, never issuing a request per switch.
    expect(navSource).not.toMatch(/fetch\(/)
    expect(navSource).toMatch(/const \[index, setIndex\] = useState\(0\)/)
  })
})
