import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Public event artwork — natural aspect-ratio rendering fix. Production
// visual review found the large primary artwork on the public event
// detail page was being forced into a landscape/banner-shaped frame: the
// old CSS fixed max-height (560px desktop / 460px mobile) combined with
// width:auto;height:auto meant a true PORTRAIT poster hit the height cap
// before the column's own width, rendering far narrower than the column
// and leaving heavy letterboxing on either side — visually reading as
// "cropped to a banner." A first revision of this fix replaced the fixed
// px cap with a viewport-relative `max-height: 85vh` "safety valve" —
// that was ALSO wrong: a perfectly ordinary portrait poster (e.g.
// 1000x1400 at a ~540px column width renders ~756px tall) exceeds 85vh
// on any desktop viewport under ~890px tall, silently reintroducing the
// same letterboxing bug for completely normal artwork. The final fix
// removes every height constraint entirely: intrinsic aspect ratio is
// the sole sizing authority (width:100%;height:auto;max-width:100%),
// and the page is allowed to scroll taller for a tall portrait poster —
// that is correct, expected behaviour, not a bug. This suite proves that
// fix, and the deliberately UNCHANGED surfaces: the hub/listing card
// thumbnail (which intentionally crops for grid consistency) and the
// manager-side artwork components (a completely separate implementation,
// never shared with this file).
//
// Static source-text assertion, not a claim of proven rendering
// behaviour — this project has no jsdom/React Testing Library harness.
// See tennisSessionManagementUiStaticCheck.test.ts for the same caveat
// spelled out in full.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')

const clientSource = read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx')
const hubSource = read('app/e/[organisationSlug]/PublicEventsHubClient.tsx')
const managerSource = read('app/events/[id]/EventDetailClient.tsx')
const ticketSource = read('app/t/[token]/page.tsx')

describe('Public event detail — primary artwork no longer forces a landscape-shaped crop', () => {
  it('the old fixed max-height rule (560px/460px) is gone', () => {
    expect(clientSource).not.toMatch(/max-height:\s*560px/)
    expect(clientSource).not.toMatch(/max-height:\s*460px/)
  })

  it('the artwork image is width:100%;height:auto — fills its column, height follows the image\'s own ratio', () => {
    const ruleStart = clientSource.indexOf('.bb-event-artwork-img {')
    expect(ruleStart).toBeGreaterThan(-1)
    const ruleEnd = clientSource.indexOf('}', ruleStart)
    const rule = clientSource.slice(ruleStart, ruleEnd)
    expect(rule).toContain('width: 100%')
    expect(rule).toContain('height: auto')
  })

  it('no max-height remains at all — not a fixed px value, not a viewport-relative one — intrinsic aspect ratio is the sole sizing authority', () => {
    const ruleStart = clientSource.indexOf('.bb-event-artwork-img {')
    const ruleEnd = clientSource.indexOf('}', ruleStart)
    const rule = clientSource.slice(ruleStart, ruleEnd)
    expect(rule).not.toMatch(/max-height/)
  })

  it('the main artwork can never be viewport-height constrained — no vh/vw/svh/dvh unit appears on the artwork rule at all', () => {
    const ruleStart = clientSource.indexOf('.bb-event-artwork-img {')
    const ruleEnd = clientSource.indexOf('}', ruleStart)
    const rule = clientSource.slice(ruleStart, ruleEnd)
    expect(rule).not.toMatch(/\d+(vh|vw|svh|dvh|lvh)/)
  })

  it('max-width:100% is present as a defensive ceiling (never binding in normal layout, since width is already 100%) — not a height constraint', () => {
    const ruleStart = clientSource.indexOf('.bb-event-artwork-img {')
    const ruleEnd = clientSource.indexOf('}', ruleStart)
    const rule = clientSource.slice(ruleStart, ruleEnd)
    expect(rule).toContain('max-width: 100%')
  })

  it('no forced presentation aspect-ratio (CSS aspect-ratio property) is applied to the primary artwork', () => {
    const ruleStart = clientSource.indexOf('.bb-event-artwork-img {')
    const ruleEnd = clientSource.indexOf('}', ruleStart)
    const rule = clientSource.slice(ruleStart, ruleEnd)
    expect(rule).not.toContain('aspect-ratio')
  })

  it('object-fit is removed as redundant — with no competing max-height, there is no constrained box left for it to "fit" into, and it must never be `cover`', () => {
    const ruleStart = clientSource.indexOf('.bb-event-artwork-img {')
    const ruleEnd = clientSource.indexOf('}', ruleStart)
    const rule = clientSource.slice(ruleStart, ruleEnd)
    expect(rule).not.toContain('object-fit')
  })

  it('the EventArtwork component no longer flex-centers a narrower image (unnecessary once the image always fills its container width)', () => {
    const fnStart = clientSource.indexOf('function EventArtwork(')
    const fnEnd = clientSource.indexOf('\n}', fnStart) + 2
    const fn = clientSource.slice(fnStart, fnEnd)
    expect(fn).not.toContain("display: 'flex'")
    expect(fn).not.toContain("justifyContent: 'center'")
  })

  it('the frame (border/shadow/rounded corners) is preserved — overflow:hidden remains, but only to clip rounded corners, never to crop content (image height is never independently constrained smaller than its own rendered size)', () => {
    const fnStart = clientSource.indexOf('function EventArtwork(')
    const fnEnd = clientSource.indexOf('\n}', fnStart) + 2
    const fn = clientSource.slice(fnStart, fnEnd)
    expect(fn).toContain('overflow: \'hidden\'')
    expect(fn).toContain('borderRadius: 18')
    expect(fn).not.toMatch(/height:\s*['"]?\d/) // no fixed pixel height on the wrapper
  })

  it('no image-loss guard is removed — a failed load still renders nothing rather than a broken-image icon', () => {
    const fnStart = clientSource.indexOf('function EventArtwork(')
    const fnEnd = clientSource.indexOf('\n}', fnStart) + 2
    const fn = clientSource.slice(fnStart, fnEnd)
    expect(fn).toContain('onError={() => setFailed(true)}')
    expect(fn).toContain('if (failed) return null')
  })

  it('still a plain <img>, not next/image — the deliberate prior-session decision (arbitrary external host, no next/image remote-pattern allow-list) is unchanged', () => {
    const fnStart = clientSource.indexOf('function EventArtwork(')
    const fnEnd = clientSource.indexOf('\n}', fnStart) + 2
    const fn = clientSource.slice(fnStart, fnEnd)
    expect(fn).toContain('<img')
    expect(fn).not.toMatch(/next\/image/)
  })
})

describe('Portrait / landscape / square artwork all use the exact same, single sizing rule — no per-orientation branching', () => {
  it('there is exactly one .bb-event-artwork-img rule, with no JS-side orientation detection', () => {
    const occurrences = clientSource.match(/\.bb-event-artwork-img\s*\{/g) ?? []
    expect(occurrences.length).toBe(1)
    expect(clientSource).not.toMatch(/naturalWidth|naturalHeight|orientation/i)
  })
})

describe('Default and institutional themes share the exact same artwork component and sizing rule', () => {
  it('EventArtwork is never conditionally branched on `institutional` or `theme` — one implementation for every organisation', () => {
    const fnStart = clientSource.indexOf('function EventArtwork(')
    const fnEnd = clientSource.indexOf('\n}', fnStart) + 2
    const fn = clientSource.slice(fnStart, fnEnd)
    expect(fn).not.toMatch(/institutional|theme\./)
  })

  it('the artwork call site itself is unconditional on theme — same call for every organisation', () => {
    expect(clientSource).toMatch(/\{event\.artwork_url && <EventArtwork src=\{event\.artwork_url\} alt=\{`\$\{event\.name\} artwork`\} \/>\}/)
  })

  it('the only theme-driven values on the artwork frame are colour tokens (border/background/shadow), never sizing — sizing behaviour is identical across every theme', () => {
    const fnStart = clientSource.indexOf('function EventArtwork(')
    const fnEnd = clientSource.indexOf('\n}', fnStart) + 2
    const fn = clientSource.slice(fnStart, fnEnd)
    expect(fn).toContain('var(--bbpe-section-bg)')
    expect(fn).toContain('rgba(var(--bbpe-accent-rgb)')
    // No theme-conditional width/height/max-height anywhere in the component.
    expect(fn).not.toMatch(/institutional \? .*(width|height|maxHeight)/)
  })
})

describe('Listing/thumbnail artwork is deliberately unchanged — this fix is scoped to the primary detail-page artwork only', () => {
  it('the hub event-card thumbnail still intentionally uses a fixed 16:9 aspect ratio and object-fit: cover', () => {
    const start = hubSource.indexOf("aspectRatio: '16 / 9'")
    expect(start).toBeGreaterThan(-1)
    const nearby = hubSource.slice(start, start + 500)
    expect(nearby).toContain("objectFit: 'cover'")
  })

  it('the ticket page\'s small artwork thumbnail is unchanged — a deliberately different, compact context, not the large primary artwork', () => {
    expect(ticketSource).toMatch(/maxHeight:\s*220/)
    expect(ticketSource).toContain("objectFit: 'cover'")
  })

  it('the manager-side artwork preview/thumbnail components are a completely separate implementation, never shared with the public detail page', () => {
    expect(managerSource).toContain('function ArtworkThumb')
    expect(managerSource).not.toContain('function EventArtwork')
    expect(managerSource).not.toMatch(/\.bb-event-artwork-img/)
  })
})

describe('No event business logic changed by this presentation-only fix', () => {
  it('PublicEventClient handler/API-call shapes are unchanged', () => {
    expect(clientSource).toContain('async function handleSubmit(')
    expect(clientSource).toContain("${paid ? 'checkout' : 'register'}")
    expect(clientSource).toContain('computeSelectionTotalCents')
  })

  it('artwork upload/validation logic (a separate concern, in a separate file) was not touched by this pass', () => {
    const validationSource = read('lib/events/validation.ts')
    expect(validationSource).toMatch(/artwork_url/)
    // No new artwork-shape/dimension validation was introduced here —
    // this fix is presentation-only, not upload-time validation.
    expect(validationSource).not.toMatch(/aspectRatio|naturalWidth|naturalHeight/i)
  })

  it('EventHeader() — the default theme\'s own header — remains completely untouched (org-agnostic contract)', () => {
    const fnStart = clientSource.indexOf('function EventHeader()')
    const fnEnd = clientSource.indexOf('\n}', fnStart) + 2
    const headerBody = clientSource.slice(fnStart, fnEnd)
    expect(headerBody).not.toMatch(/organisationSlug|eventSlug|event\.name|event\.title|theme|institutional/)
  })
})
