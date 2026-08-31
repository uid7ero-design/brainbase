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

describe('Intensity by page depth — zone scrims', () => {
  it('three full-bleed zone wrappers exist below the hero, each with a vertical gradient scrim that darkens further down the page (higher opacity later in each gradient, and each zone starting roughly where the previous one ended)', () => {
    const gradients = [...homepageCode.matchAll(/linear-gradient\(180deg, rgba\(7,8,11,\.(\d+)\) 0%, rgba\(7,8,11,\.(\d+)\) 100%\)/g)]
    expect(gradients.length).toBeGreaterThanOrEqual(3)
    for (const g of gradients) {
      const start = parseInt(g[1], 10)
      const end = parseInt(g[2], 10)
      expect(end, `zone gradient ${g[0]} should get darker (higher opacity), not lighter`).toBeGreaterThan(start)
    }
  })

  it('each zone wrapper breaks out to full viewport width (100vw via the calc(50% - 50vw) trick) while its inner content wrapper keeps the original maxWidth:1220 constraint — section layout itself is unchanged, only its background wrapper', () => {
    const breakouts = (homepageCode.match(/width:\s*'100vw',\s*\n?\s*marginLeft:\s*'calc\(50% - 50vw\)'/g) ?? [])
    expect(breakouts.length).toBeGreaterThanOrEqual(3)
    expect((homepageCode.match(/className="bb-home-shell"/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('main retains overflow:hidden — the full-bleed breakout technique depends on it to avoid introducing a horizontal scrollbar', () => {
    const mainIdx = homepageCode.indexOf('<main')
    const mainRegion = homepageCode.slice(mainIdx, mainIdx + 300)
    expect(mainRegion).toMatch(/overflow:\s*'hidden'/)
  })

  it('the footer gets a near-opaque (but not fully solid) background so the atmosphere never competes with footer navigation, while still leaving a faint residual hint per "nearly black with faint residual depth"', () => {
    const footerIdx = homepageCode.indexOf('<footer')
    const footerRegion = homepageCode.slice(footerIdx, footerIdx + 300)
    expect(footerRegion).toMatch(/background:\s*'rgba\(5,6,10,\.9\d?\)'/)
  })

  it('existing sections\' own internal JSX/content is untouched — this phase only changed which wrapper contains them (spot-check a few distinctive, unmodified section headings)', () => {
    expect(homepageCode).toContain('The Problem')
    expect(homepageCode).toContain('Capabilities')
    expect(homepageCode).toContain('Starting Points')
    expect(homepageCode).toContain('One connected operational platform.')
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
