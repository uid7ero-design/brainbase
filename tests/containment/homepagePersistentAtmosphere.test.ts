import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

// Phase D.3.1B — homepage orbit alignment + persistent atmosphere. Static
// source-text containment per this repo's convention (no jsdom/RTL
// harness).
//
// Root change this phase makes: OrbitalBackground moves from a hero-
// scoped absolutely-positioned layer to a single, page-level position:
// fixed layer, so the atmosphere persists behind content as the page
// scrolls instead of cutting to flat black immediately below the hero.
// Intensity-by-depth is achieved entirely through page-local scrim
// wrappers around the existing homepage sections — OrbitalBackground
// itself is never duplicated or re-tuned per section.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const homepageSource = read('app/page.tsx')
const homepageCode = stripComments(homepageSource)
const loginSource = read('app/login/page.tsx')
const signupSource = read('app/signup/page.tsx')
const hlnaPageSource = read('app/hlna/page.tsx')
const helenaWorkspaceSource = read('components/helena/HelenaWorkspace.jsx')
const orbitalBackgroundSource = read('components/brand/OrbitalBackground.tsx')

describe('Hero / HLNA card alignment', () => {
  it('HeroOrbitMark\'s wrapper carries a small rightward offset (reduced from D.3.1A\'s +26px to +8px, per live-measured centre-X alignment against the HLNA card below it) and the same upward offset', () => {
    const markWrapperIdx = homepageCode.indexOf('<HeroOrbitMark')
    const precedingRegion = homepageCode.slice(Math.max(0, markWrapperIdx - 400), markWrapperIdx)
    expect(precedingRegion).toMatch(/translate\(calc\(-50% \+ 8px\), calc\(-50% - 20px\)\)/)
  })
})

describe('Persistent atmosphere — single page-level OrbitalBackground', () => {
  it('exactly one OrbitalBackground instance on the homepage, positioned fixed, appearing before the hero section in source order (page-level, not hero-scoped)', () => {
    expect((homepageSource.match(/<OrbitalBackground/g) ?? []).length).toBe(1)
    const orbitalIdx = homepageSource.indexOf('<OrbitalBackground')
    const heroIdx = homepageSource.indexOf('className="bb-home-hero"')
    expect(orbitalIdx).toBeLessThan(heroIdx)
    const region = homepageSource.slice(orbitalIdx, orbitalIdx + 300)
    expect(region).toMatch(/position:\s*'fixed'/)
  })

  it('OrbitalBackground.tsx itself is untouched by this phase — the persistent-atmosphere behaviour comes entirely from the style override this component already supported, not a new prop or a modified default', () => {
    expect(orbitalBackgroundSource).toMatch(/position:\s*'absolute'/)
    expect(orbitalBackgroundSource).not.toContain("'fixed'")
  })

  it('remains decorative-safe: aria-hidden and pointer-events:none, same as every other OrbitalBackground usage', () => {
    const orbitalIdx = homepageSource.indexOf('<OrbitalBackground')
    // OrbitalBackground itself sets aria-hidden/pointer-events internally
    // (verified in orbitalBackground.test.ts); this just confirms the
    // homepage call site doesn't override them away.
    const region = homepageSource.slice(orbitalIdx, orbitalIdx + 300)
    expect(region).not.toMatch(/aria-hidden=\{false\}|pointerEvents:\s*'auto'/)
  })

  it('no JS scroll listener was introduced to drive the persistent-background effect — it is pure CSS position:fixed plus static scrim gradients', () => {
    expect(homepageCode).not.toMatch(/addEventListener\(\s*['"]scroll['"]/)
    expect(homepageCode).not.toContain('onScroll')
    expect(homepageCode).not.toMatch(/window\.scrollY|window\.pageYOffset/)
  })
})

// Updated during Phase D.3.1C: live scroll QA found visible brightness
// seams at every boundary between the three independent D.3.1B zone
// scrims. Root cause, confirmed by measuring each zone's actual rendered
// height in a live browser: each zone's gradient spans 0%->100% over its
// own arbitrary, content-driven height, so even though the colour VALUES
// matched exactly at each boundary, the fade RATE (opacity change per
// pixel) differed by up to ~3.6x between adjacent zones — a discontinuous
// fade curve, perceived as seams. Replaced with ONE continuous veil: a
// single absolutely-positioned div (inset:0, sized automatically by its
// container's real content height — never a hardcoded pixel value) with
// one multi-stop gradient spanning the entire below-hero region.
describe('Intensity by page depth — one continuous veil (not independent zone scrims)', () => {
  it('exactly one continuous atmosphere veil exists below the hero — a single multi-stop vertical gradient, not several independent ones whose boundaries could seam', () => {
    const veilMatches = [...homepageCode.matchAll(/linear-gradient\(180deg,\s*rgba\(7,8,11,\.(\d+)\)\s*0%,\s*rgba\(7,8,11,\.(\d+)\)\s*(?:\d+%,\s*rgba\(7,8,11,\.(\d+)\)\s*(?:\d+%,\s*rgba\(7,8,11,\.(\d+)\)\s*)?)?100%\)/g)]
    expect(veilMatches.length, 'expected exactly one below-hero atmosphere gradient').toBe(1)
    const stops = veilMatches[0].slice(1).filter(Boolean).map(n => parseInt(n, 10))
    // At least 3 stops (multi-stop, per the task's own preferred approach),
    // and strictly increasing (monotonic darkening, no gradient reset).
    expect(stops.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i], `stop ${i} (.${stops[i]}) should be darker than stop ${i - 1} (.${stops[i - 1]})`).toBeGreaterThan(stops[i - 1])
    }
  })

  it('the veil is sized via position:absolute + inset:0 against its container (derives from real content height automatically) — never a hardcoded pixel height', () => {
    const veilIdx = homepageCode.indexOf("rgba(7,8,11,.28)")
    expect(veilIdx, 'expected to find the veil gradient').toBeGreaterThan(-1)
    const precedingRegion = homepageCode.slice(Math.max(0, veilIdx - 300), veilIdx)
    expect(precedingRegion).toMatch(/position:\s*'absolute'/)
    expect(precedingRegion).toMatch(/inset:\s*0/)
    expect(homepageCode).not.toMatch(/height:\s*['"`]?\d{3,}px['"`]?,?\s*\n?\s*background:\s*'linear-gradient\(180deg/)
  })

  it('the old three independent zone gradients (D.3.1B) no longer exist — each previously had its own 0%/100% gradient scoped to its own wrapper, which is exactly what caused the seams', () => {
    // The three specific D.3.1B gradient pairs, by their exact old values.
    expect(homepageCode).not.toContain("rgba(7,8,11,.35) 0%, rgba(7,8,11,.68) 100%")
    expect(homepageCode).not.toContain("rgba(7,8,11,.68) 0%, rgba(7,8,11,.85) 100%")
    expect(homepageCode).not.toContain("rgba(7,8,11,.85) 0%, rgba(7,8,11,.95) 100%")
  })

  it('exactly one full-bleed 100vw breakout wrapper and one bb-home-shell remain below the hero — the D.3.1B three-wrapper structure was simplified, not just re-skinned', () => {
    const breakouts = (homepageCode.match(/width:\s*'100vw',\s*\n?\s*marginLeft:\s*'calc\(50% - 50vw\)'/g) ?? [])
    expect(breakouts.length).toBe(1)
    expect((homepageCode.match(/className="bb-home-shell"/g) ?? []).length).toBe(1)
  })

  it('the veil is decorative-safe: aria-hidden and pointer-events:none', () => {
    const veilIdx = homepageCode.indexOf("rgba(7,8,11,.28)")
    const divStart = homepageCode.lastIndexOf('<div', veilIdx)
    const veilDivRegion = homepageCode.slice(divStart, veilIdx)
    expect(veilDivRegion).toContain('aria-hidden="true"')
    expect(veilDivRegion).toMatch(/pointerEvents:\s*'none'/)
  })

  it('main retains overflow:hidden — the full-bleed breakout technique depends on it to avoid introducing a horizontal scrollbar', () => {
    const mainIdx = homepageCode.indexOf('<main')
    const mainRegion = homepageCode.slice(mainIdx, mainIdx + 300)
    expect(mainRegion).toMatch(/overflow:\s*'hidden'/)
  })

  // Updated during Phase D.3.1D: live DOM measurement found a 72px gap
  // between the veil wrapper's old bottom edge and the footer's own start
  // (exactly the footer's own marginTop:72) where neither the veil nor
  // the footer's separate background covered the fixed OrbitalBackground
  // — a visible undimmed band. Fixed by moving <footer> INSIDE the same
  // full-bleed veil wrapper (so the veil's inset:0 sizing automatically
  // extends over it, closing the gap) and removing the footer's own
  // separate background entirely — a second independent background would
  // itself be "a second atmospheric treatment", which the task explicitly
  // avoids. The veil now reaches the footer's own bottom edge directly.
  it('footer is inside the same continuous-veil wrapper (not a sibling after it) and no longer carries its own separate background — the veil itself now reaches the footer', () => {
    const shellCloseIdx = homepageCode.indexOf('</section>\n        </div>')
    const footerIdx = homepageCode.indexOf('<footer')
    const outerWrapperCloseIdx = homepageCode.lastIndexOf('</div>')
    expect(shellCloseIdx).toBeGreaterThan(-1)
    expect(footerIdx).toBeGreaterThan(shellCloseIdx)
    // The outer 100vw wrapper's closing </div> comes AFTER </footer>, not before it.
    expect(outerWrapperCloseIdx).toBeGreaterThan(homepageCode.indexOf('</footer>'))
    const footerOpenRegion = homepageCode.slice(footerIdx, footerIdx + 300)
    expect(footerOpenRegion).not.toMatch(/background:\s*'rgba\(5,6,10,/)
  })

  it('no unaccounted gap remains between content and footer — the footer\'s own marginTop is preserved as internal breathing room, not removed, since it now sits safely inside the veiled wrapper', () => {
    const footerIdx = homepageCode.indexOf('<footer')
    const footerRegion = homepageCode.slice(footerIdx, footerIdx + 200)
    expect(footerRegion).toMatch(/marginTop:\s*72/)
  })

  it('existing sections\' own internal JSX/content is untouched — this phase only changed which wrapper contains them (spot-check a few distinctive, unmodified section headings)', () => {
    expect(homepageCode).toContain('The Problem')
    expect(homepageCode).toContain('Capabilities')
    expect(homepageCode).toContain('Starting Points')
    expect(homepageCode).toContain('One connected operational platform.')
  })

  it('footer content is fully preserved — wordmark, nav links, legal links, and copyright all still present, semantic <footer> structure unchanged', () => {
    const footerIdx = homepageCode.indexOf('<footer')
    const footerCloseIdx = homepageCode.indexOf('</footer>', footerIdx)
    const footerRegion = homepageCode.slice(footerIdx, footerCloseIdx)
    expect(footerRegion).toContain('BrainBaseWordmark')
    expect(footerRegion).toContain('Client Operations')
    expect(footerRegion).toContain('Web Systems')
    expect(footerRegion).toContain('Pricing')
    expect(footerRegion).toContain('Privacy')
    expect(footerRegion).toContain('Terms')
    expect(footerRegion).toContain('© 2026 BRΛINBΛSE')
  })

  it('still exactly one OrbitalBackground instance on the homepage (page-level, fixed) — the footer fix did not introduce a second one', () => {
    expect((homepageSource.match(/<OrbitalBackground/g) ?? []).length).toBe(1)
  })
})

describe('Login / signup containment — D.3 treatment unchanged', () => {
  it('login and signup keep their own hero-scoped, absolutely-positioned OrbitalBackground — not converted to a page-level fixed layer by this homepage-only phase', () => {
    for (const src of [loginSource, signupSource]) {
      expect(src).toMatch(/<OrbitalBackground variant="field" intensity="low" placement="center" \/>/)
      expect(src).not.toMatch(/style=\{\{\s*position:\s*'fixed'/)
    }
  })
})

describe('/HLNA containment', () => {
  it('/hlna and HelenaWorkspace remain untouched — no persistent-atmosphere changes, no OrbitalBackground at all', () => {
    expect(hlnaPageSource).not.toContain('OrbitalBackground')
    expect(helenaWorkspaceSource).not.toContain('OrbitalBackground')
  })
})
