import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

// Phase D.3.1 — homepage hero visual correction. Static source-text
// containment per this repo's convention (no jsdom/RTL harness).
//
// Root cause this phase fixes: the old raster lens-style hero image
// (public/hlna-orb-only.webp) read as a competing brand system next to the
// new Hybrid Orbit atmosphere, and the hero was visually boxed in by
// bb-home-shell's maxWidth:1220 constraint (OrbitalBackground, scoped to
// the hero section, was constrained to that same 1220px box rather than
// spanning the viewport).


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
const heroOrbitMarkSource = read('components/brand/HeroOrbitMark.tsx')
const heroOrbitMarkCode = stripComments(heroOrbitMarkSource)
const helenaOrbitalSource = read('components/brand/HelenaOrbital.tsx')
const orbitalBackgroundSource = read('components/brand/OrbitalBackground.tsx')
const loginSource = read('app/login/page.tsx')
const signupSource = read('app/signup/page.tsx')
const hlnaPageSource = read('app/hlna/page.tsx')
const helenaWorkspaceSource = read('components/helena/HelenaWorkspace.jsx')

describe('Old lens-style hero visual is no longer the dominant homepage visual', () => {
  it('the homepage no longer renders the standalone raster hero <img> (hlna-orb-only.webp) that used to be the giant hero focal point', () => {
    expect(homepageCode).not.toMatch(/<img[^>]*hlna-orb-only\.webp/)
    expect(homepageCode).not.toContain('orbFloat')
  })

  it('the underlying asset itself is untouched — HlnaOrb.jsx (used elsewhere as a real functional assistant visual: MicButton, IntelRail, demo, command, BrainBase.jsx fallback) still loads it', () => {
    const hlnaOrbSource = read('components/brand/HlnaOrb.jsx')
    expect(hlnaOrbSource).toContain("'/hlna-orb-only.webp'")
    expect(fs.existsSync(path.join(root, 'public/hlna-orb-only.webp'))).toBe(true)
  })
})

describe('HeroOrbitMark — dedicated static/presentational Hybrid Orbit hero visual', () => {
  it('exists as its own component, reusing the approved master-mark geometry (not inventing new shapes)', () => {
    expect(heroOrbitMarkSource).toMatch(/export function HeroOrbitMark\(/)
    // Same radii as the approved master mark / HelenaOrbital's own documented ratios.
    expect(heroOrbitMarkCode).toContain('r="164"')
    expect(heroOrbitMarkCode).toContain('r="124"')
    expect(heroOrbitMarkCode).toContain('r="84"')
    expect(heroOrbitMarkCode).toContain('r="34"')
  })

  it('has exactly three rings and exactly one node per ring', () => {
    expect((heroOrbitMarkCode.match(/className="bb-hero-ring-(outer|mid|inner)"/g) ?? []).length).toBe(3)
    // One node circle per ring group, each a distinct palette colour.
    expect(heroOrbitMarkCode).toMatch(/const PURPLE = '#A855F7'/)
    expect(heroOrbitMarkCode).toMatch(/const VIOLET = '#7C5CFF'/)
    expect(heroOrbitMarkCode).toMatch(/const CYAN = '#00D4FF'/)
    expect((heroOrbitMarkCode.match(/fill=\{PURPLE\}/g) ?? []).length).toBe(1)
    expect((heroOrbitMarkCode.match(/fill=\{VIOLET\}/g) ?? []).length).toBe(1)
    expect((heroOrbitMarkCode.match(/fill=\{CYAN\}/g) ?? []).length).toBe(1)
  })

  it('is purely presentational — no state prop, no listening/thinking/speaking, cannot be mistaken for the living Helena assistant actually being present', () => {
    expect(heroOrbitMarkCode).not.toMatch(/useState|useEffect|useRef/)
    expect(heroOrbitMarkCode).not.toMatch(/HelenaVisualState|speechRef|audioLevel|listening|thinking|speaking/)
    expect(heroOrbitMarkCode).not.toContain('HelenaOrbital')
  })

  it('is aria-hidden (decorative)', () => {
    expect(heroOrbitMarkSource).toContain('aria-hidden="true"')
  })

  it('respects prefers-reduced-motion — the static three-ring/three-node/core composition remains complete without animation', () => {
    const mqIdx = heroOrbitMarkSource.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(mqIdx).toBeGreaterThan(-1)
    const block = heroOrbitMarkSource.slice(mqIdx, heroOrbitMarkSource.indexOf('}', heroOrbitMarkSource.indexOf('{', mqIdx) + 100))
    expect(block).toMatch(/animation:\s*none\s*!important/)
  })

  it('reuses HelenaOrbital\'s own established idle-state ring speeds (78s/60s/40s) rather than inventing new timing values, keeping motion language consistent', () => {
    expect(helenaOrbitalSource).toMatch(/outer:\s*78/)
    expect(helenaOrbitalSource).toMatch(/middle:\s*60/)
    expect(helenaOrbitalSource).toMatch(/inner:\s*40/)
    expect(heroOrbitMarkSource).toContain('78s linear infinite')
    expect(heroOrbitMarkSource).toContain('60s linear infinite')
    expect(heroOrbitMarkSource).toContain('40s linear infinite')
  })
})

describe('No duplicate/competing hero system', () => {
  it('HeroOrbitMark and HelenaOrbital never import each other — two distinct, non-overlapping visual systems', () => {
    expect(heroOrbitMarkCode).not.toContain('HelenaOrbital')
    expect(helenaOrbitalSource).not.toContain('HeroOrbitMark')
  })

})



describe('HLNA input card position', () => {
  it('the HLNA input card still exists, unchanged in function, positioned below the hero visual (not overlapping it) via normal document flow', () => {
    const markIdx = homepageCode.indexOf('<HeroOrbitMark')
    const cardIdx = homepageCode.indexOf('CommandDemo placeholder', markIdx)
    expect(cardIdx, 'expected the HLNA card after the hero mark in source order').toBeGreaterThan(markIdx)
  })
})



describe('Login / signup containment — D.3 adoption unchanged', () => {
  it('login and signup still use OrbitalBackground exactly as D.3 left them (field/low/center) — untouched by this homepage-only phase', () => {
    for (const src of [loginSource, signupSource]) {
      expect(src).toContain("import { OrbitalBackground } from '@/components/brand/OrbitalBackground'")
      expect(src).toMatch(/<OrbitalBackground variant="field" intensity="low" placement="center" \/>/)
    }
  })

  it('login and signup do not import HeroOrbitMark — that is a homepage-only visual', () => {
    expect(loginSource).not.toContain('HeroOrbitMark')
    expect(signupSource).not.toContain('HeroOrbitMark')
  })
})

describe('/HLNA containment', () => {
  it('/hlna and HelenaWorkspace remain untouched — no OrbitalBackground, no HeroOrbitMark, HelenaOrbital still the only visual there', () => {
    expect(hlnaPageSource).not.toContain('OrbitalBackground')
    expect(hlnaPageSource).not.toContain('HeroOrbitMark')
    expect(helenaWorkspaceSource).not.toContain('OrbitalBackground')
    expect(helenaWorkspaceSource).not.toContain('HeroOrbitMark')
    expect(helenaWorkspaceSource).toContain('HelenaOrbital')
  })
})

describe('OrbitalBackground component itself — untouched by this homepage-only phase', () => {
  it('OrbitalBackground.tsx was not modified to fix a homepage-specific issue — tuning happened page-locally on the homepage instead', () => {
    // Its own intensity scale / variant set are unchanged from D.3.
    expect(orbitalBackgroundSource).toMatch(/low:\s*0\.4/)
    expect(orbitalBackgroundSource).toMatch(/medium:\s*1/)
    expect(orbitalBackgroundSource).toMatch(/high:\s*1\.4/)
  })
})

describe('Brand asset rules', () => {
  it('no runtime reference to the external OneDrive brand-kit path', () => {
    expect(homepageCode).not.toMatch(/OneDrive/i)
    expect(heroOrbitMarkCode).not.toMatch(/OneDrive/i)
  })

  it('no raster artwork was generated for the new hero visual — HeroOrbitMark is pure inline SVG, no <img>/background-image referencing a new PNG/JPG/webp', () => {
    expect(heroOrbitMarkCode).not.toContain('<img')
    expect(heroOrbitMarkCode).not.toMatch(/background-image|backgroundImage/)
  })
})
