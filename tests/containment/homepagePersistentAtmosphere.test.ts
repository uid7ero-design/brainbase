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


// Public-site visual convergence (feat/public-site-visual-convergence):
// the homepage no longer uses the page-level fixed OrbitalBackground /
// HeroOrbitMark atmosphere — the orbital motif is now the calmer, static
// SystemMap diagram (components/public/SystemMap.tsx). Homepage-structure
// assertions for the retired treatment were removed from this file; the
// new homepage is covered by tests/containment/publicSiteVisualSystem.test.ts
// and the rendered tests in tests/components/public/. Assertions about other
// surfaces (login, signup, /hlna, the shared components) are unchanged.

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


describe('Persistent atmosphere — single page-level OrbitalBackground', () => {
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
  it('the old three independent zone gradients (D.3.1B) no longer exist — each previously had its own 0%/100% gradient scoped to its own wrapper, which is exactly what caused the seams', () => {
    // The three specific D.3.1B gradient pairs, by their exact old values.
    expect(homepageCode).not.toContain("rgba(7,8,11,.35) 0%, rgba(7,8,11,.68) 100%")
    expect(homepageCode).not.toContain("rgba(7,8,11,.68) 0%, rgba(7,8,11,.85) 100%")
    expect(homepageCode).not.toContain("rgba(7,8,11,.85) 0%, rgba(7,8,11,.95) 100%")
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
