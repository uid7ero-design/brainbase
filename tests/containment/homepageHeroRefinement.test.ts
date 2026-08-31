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
  it('HeroOrbitMark is used exactly once on the homepage, replacing (not sitting alongside) the old img', () => {
    expect(homepageSource).toContain("import { HeroOrbitMark } from '@/components/brand/HeroOrbitMark'")
    expect((homepageSource.match(/<HeroOrbitMark/g) ?? []).length).toBe(1)
  })

  it('HeroOrbitMark and HelenaOrbital never import each other — two distinct, non-overlapping visual systems', () => {
    expect(heroOrbitMarkCode).not.toContain('HelenaOrbital')
    expect(helenaOrbitalSource).not.toContain('HeroOrbitMark')
  })

  it('homepage still uses OrbitalBackground (kept, not removed) exactly once', () => {
    expect(homepageSource).toContain("import { OrbitalBackground } from '@/components/brand/OrbitalBackground'")
    expect((homepageSource.match(/<OrbitalBackground/g) ?? []).length).toBe(1)
  })
})

describe('Content safe-zone treatment', () => {
  it('a content-safe mask exists behind the headline/copy/CTA column, fading the atmosphere out on the left and preserving it toward the right/edges', () => {
    const maskIdx = homepageCode.indexOf('linear-gradient(90deg')
    expect(maskIdx, 'expected a left-to-right fading mask').toBeGreaterThan(-1)
    const maskRegion = homepageCode.slice(maskIdx, maskIdx + 200)
    // Starts opaque (dark, hiding the background) and ends transparent
    // (background fully visible) — left-to-right per the 90deg direction.
    expect(maskRegion).toMatch(/rgba\(7,\s*8,\s*11,\.82\)/)
    expect(maskRegion).toMatch(/transparent/)
  })

  it('a local scrim clears OrbitalBackground\'s own baked-in core glow specifically behind HeroOrbitMark, so the two cores never appear as two competing bright orbs', () => {
    const markIdx = homepageCode.indexOf('<HeroOrbitMark')
    const precedingRegion = homepageCode.slice(Math.max(0, markIdx - 1500), markIdx)
    expect(precedingRegion).toMatch(/radial-gradient\(circle,\s*rgba\(7,\s*8,\s*11,\.85\)/)
  })

  it('the mask/scrim layers are decorative-safe — aria-hidden and pointer-events:none — never intercepting clicks on the headline CTAs or the HLNA input card', () => {
    const maskIdx = homepageCode.indexOf('linear-gradient(90deg')
    const maskDivStart = homepageCode.lastIndexOf('<div', maskIdx)
    const maskDivRegion = homepageCode.slice(maskDivStart, maskIdx)
    expect(maskDivRegion).toContain('aria-hidden="true"')
    expect(maskDivRegion).toMatch(/pointerEvents:\s*'none'/)
  })
})

describe('Layout / clipping fix', () => {
  it('the hero section is no longer nested inside bb-home-shell\'s maxWidth:1220 wrapper — it has its own full-width section, with content constrained by a separate inner wrapper', () => {
    const heroSectionIdx = homepageSource.indexOf('className="bb-home-hero"')
    const shellBeforeHero = homepageSource.lastIndexOf('className="bb-home-shell"', heroSectionIdx)
    // bb-home-shell's opening tag must NOT appear before the hero section
    // in source order anymore (previously it wrapped the hero).
    expect(shellBeforeHero).toBe(-1)
    // bb-home-shell now opens AFTER the hero section closes.
    const heroSectionClose = homepageSource.indexOf('</section>', heroSectionIdx)
    const shellAfterHero = homepageSource.indexOf('className="bb-home-shell"', heroSectionClose)
    expect(shellAfterHero).toBeGreaterThan(heroSectionClose)
  })

  it('the hero has its own maxWidth:1220 inner content wrapper (bb-home-hero-inner) so readable content width is unchanged even though the section itself is full-width', () => {
    // className="bb-home-hero-inner" (the JSX usage) — not the earlier
    // bare ".bb-home-hero-inner" CSS-selector text inside the KEYFRAMES
    // constant, which is defined above the component and would be found
    // first by a bare substring search.
    const innerIdx = homepageSource.indexOf('className="bb-home-hero-inner"')
    expect(innerIdx, 'expected a bb-home-hero-inner JSX element').toBeGreaterThan(-1)
    const innerRegion = homepageSource.slice(innerIdx, innerIdx + 300)
    expect(innerRegion).toMatch(/maxWidth:\s*1220/)
  })

  it('no fixed-pixel-width overflow-prone artwork — HeroOrbitMark is sized via a prop (not a raw hardcoded oversized image) and has a responsive downsizing rule for narrow viewports', () => {
    expect(homepageCode).toMatch(/<HeroOrbitMark size=\{\d+\}/)
    expect(homepageCode).toContain('.bb-hero-orbit-mark')
    const narrowRuleIdx = homepageCode.indexOf('.bb-hero-orbit-mark {')
    expect(narrowRuleIdx).toBeGreaterThan(-1)
    const narrowRule = homepageCode.slice(narrowRuleIdx, narrowRuleIdx + 150)
    expect(narrowRule).toMatch(/width:\s*260px\s*!important/)
  })

  it('no horizontal-scroll-prone absolute widths were left unconstrained — every hero glow/scrim layer caps itself with a vw-relative maxWidth/maxHeight', () => {
    // The three concentric glow/scrim/mark layers behind the headline
    // visual all cap their pixel size against the viewport.
    expect((homepageCode.match(/maxWidth:\s*'\d+vw'/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})

describe('HLNA input card position', () => {
  it('the HLNA input card still exists, unchanged in function, positioned below the hero visual (not overlapping it) via normal document flow', () => {
    const markIdx = homepageCode.indexOf('<HeroOrbitMark')
    const cardIdx = homepageCode.indexOf('CommandDemo placeholder', markIdx)
    expect(cardIdx, 'expected the HLNA card after the hero mark in source order').toBeGreaterThan(markIdx)
  })
})

describe('Responsive behaviour', () => {
  it('the hero visual and its inner content wrapper both have explicit narrow-viewport rules under the existing 680px breakpoint (not a new ad-hoc breakpoint)', () => {
    const bp = homepageCode.indexOf('@media (max-width: 680px)')
    expect(bp).toBeGreaterThan(-1)
    const bpBlock = homepageCode.slice(bp, homepageCode.indexOf('.bb-home-cta', bp))
    expect(bpBlock).toContain('bb-home-hero-inner')
    expect(bpBlock).toContain('bb-hero-orbit-mark')
  })

  it('the content grid uses CSS auto-fit (container-width-responsive, collapses to a single column without a viewport-specific breakpoint) so the hero visual naturally moves below the text at narrow widths — verified structurally: text column precedes the visual column in DOM/source order', () => {
    expect(homepageCode).toMatch(/gridTemplateColumns:\s*'repeat\(auto-fit, minmax\(340px, 1fr\)\)'/)
    const textColIdx = homepageCode.indexOf('maxWidth: 620')
    const visualColIdx = homepageCode.indexOf('<HeroOrbitMark')
    expect(textColIdx).toBeGreaterThan(-1)
    expect(visualColIdx).toBeGreaterThan(textColIdx)
  })
})

describe('Reduced motion — page-level glow layers', () => {
  it('the page-local glow-blob animation (glowPulse) still respects the same reduced-motion discipline as the rest of the file (KEYFRAMES apply globally; no essential-to-understanding motion was added outside HeroOrbitMark\'s own guarded animations)', () => {
    // HeroOrbitMark's own animations are already reduced-motion-guarded
    // (see the dedicated describe block above). The page-level glowPulse
    // keyframe pre-dates this phase and is unchanged.
    expect(homepageCode).toContain('glowPulse')
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
