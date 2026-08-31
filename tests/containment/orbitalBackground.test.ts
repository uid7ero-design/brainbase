import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

// Phase D.3 — reusable Hybrid Orbit atmospheric background (OrbitalBackground).
// Static source-text containment per this repo's convention (no jsdom/RTL
// harness — see AGENTS.md/CLAUDE.md and every prior phase's test file).
//
// This component is deliberately distinct from the other two Hybrid Orbit
// visual concepts: BrainBaseWordmark (static corporate brand) and
// HelenaOrbital (the living, stateful assistant visual). It must never
// import/render HelenaOrbital, and HelenaOrbital must never import it back.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const orbitalBackgroundSource = read('components/brand/OrbitalBackground.tsx')
// Comment-stripped: the component's own header comment documents its
// relationship to HelenaOrbital and where the asset was copied from
// (BrainBase_Hybrid_Orbit_Brand_Kit_COMPLETE, in prose) — real code-level
// containment checks below must not be tripped up by that documentation.
const orbitalBackgroundCode = stripComments(orbitalBackgroundSource)
const helenaOrbitalSource = read('components/brand/HelenaOrbital.tsx')
const loginSource = read('app/login/page.tsx')
const signupSource = read('app/signup/page.tsx')
const homepageSource = read('app/page.tsx')
const connectSource = read('app/connect/page.tsx')
const requestDemoSource = read('app/request-demo/page.tsx')
const hlnaPageSource = read('app/hlna/page.tsx')
const helenaWorkspaceSource = read('components/helena/HelenaWorkspace.jsx')
const organisationDashboardSource = read('components/dashboard/OrganisationDashboard.tsx')
const packageJson = read('package.json')

describe('OrbitalBackground — component identity and API', () => {
  it('exists as a shared, exported component with a small, disciplined prop API', () => {
    expect(orbitalBackgroundSource).toMatch(/export function OrbitalBackground\(/)
    expect(orbitalBackgroundSource).toMatch(/variant\?:\s*OrbitalVariant/)
    expect(orbitalBackgroundSource).toMatch(/intensity\?:\s*OrbitalIntensity/)
    expect(orbitalBackgroundSource).toMatch(/placement\?:\s*OrbitalPlacement/)
  })

  it('supports a "field" (full) and "veil" (nebula-wash-only, no asset/rings) variant — not a giant theming engine', () => {
    expect(orbitalBackgroundSource).toMatch(/export type OrbitalVariant = 'field' \| 'veil'/)
  })

  it('references the approved brand-kit asset copied read-only into this repo, never the external OneDrive kit path at runtime', () => {
    expect(orbitalBackgroundSource).toContain("/Brand/backgrounds/brainbase-orbital-field.svg")
    expect(orbitalBackgroundSource).not.toMatch(/OneDrive/i)
    // The external kit's own folder name may legitimately appear in prose
    // documentation (explaining provenance) but never as part of a real
    // import/fetch/url() — no runtime code path may resolve through it.
    expect(orbitalBackgroundSource).not.toMatch(/(from|import|require|url\()\s*['"`][^'"`]*BrainBase_Hybrid_Orbit_Brand_Kit_COMPLETE/)
  })

  it('the referenced background asset actually exists in the repo (copied, not just referenced)', () => {
    expect(fs.existsSync(path.join(root, 'public/Brand/backgrounds/brainbase-orbital-field.svg'))).toBe(true)
  })
})

describe('OrbitalBackground — decorative semantics and pointer/accessibility safety', () => {
  it('is aria-hidden, non-focusable, and pointer-events:none — never intercepts clicks/selection or enters the reading/tab order', () => {
    expect(orbitalBackgroundSource).toContain('aria-hidden="true"')
    expect(orbitalBackgroundSource).toMatch(/pointerEvents:\s*'none'/)
  })

  it('positions itself absolutely at inset:0, zIndex 0 — the caller is responsible for giving its own content a higher zIndex', () => {
    expect(orbitalBackgroundSource).toMatch(/position:\s*'absolute'/)
    expect(orbitalBackgroundSource).toMatch(/inset:\s*0/)
    expect(orbitalBackgroundSource).toMatch(/zIndex:\s*0/)
  })
})

describe('OrbitalBackground — reduced motion (mandatory)', () => {
  it('disables non-essential animation under prefers-reduced-motion: reduce', () => {
    const mqIdx = orbitalBackgroundSource.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(mqIdx).toBeGreaterThan(-1)
    const block = orbitalBackgroundSource.slice(mqIdx, orbitalBackgroundSource.indexOf('}', orbitalBackgroundSource.indexOf('{', mqIdx) + 200))
    expect(block).toMatch(/animation:\s*none\s*!important/)
  })

  it('the static composition (rings, nodes, nebula wash, asset layer) does not depend on animation to render complete — every ring/layer is present in markup regardless of animation state', () => {
    // The two ring <ellipse>/<g> elements and the nebula wash divs are
    // unconditional JSX (not gated behind a "motion enabled" flag), so
    // disabling their `animation` CSS property via the reduced-motion
    // media query leaves them fully rendered, just static.
    expect(orbitalBackgroundSource).not.toMatch(/if\s*\(\s*!?reducedMotion/)
    expect(orbitalBackgroundSource).toContain('bb-orbital-ring-outer')
    expect(orbitalBackgroundSource).toContain('bb-orbital-ring-mid')
  })
})

describe('OrbitalBackground — motion respects Orbital_Motion_Spec.md (slow, never state-driven, never rotates the whole composition as one object)', () => {
  it('ring rotation cycles are within the spec\'s slow range (well over 50s), and no single wrapper rotates the entire composition together', () => {
    expect(orbitalBackgroundSource).toMatch(/bbOrbitalRingSpin 150s linear infinite/)
    expect(orbitalBackgroundSource).toMatch(/bbOrbitalRingSpinReverse 95s linear infinite/)
    // Two independently-animated <g> groups, not one outer transform
    // wrapping the whole SVG/asset. Each pattern anchored to its exact
    // duration so "bbOrbitalRingSpin" matching inside "...SpinReverse"
    // can't inflate the count.
    expect((orbitalBackgroundSource.match(/animation: 'bbOrbitalRingSpin 150s/g) ?? []).length).toBe(1)
    expect((orbitalBackgroundSource.match(/animation: 'bbOrbitalRingSpinReverse 95s/g) ?? []).length).toBe(1)
  })

  it('carries no state prop, no useState/useEffect, no ref-based imperative API — purely presentational, never reacts to conversation/assistant state', () => {
    expect(orbitalBackgroundSource).not.toMatch(/useState|useEffect|useRef/)
    expect(orbitalBackgroundSource).not.toMatch(/HelenaVisualState|speechRef|audioLevel/)
  })
})

describe('Product distinction — OrbitalBackground never merges with the living Helena visual', () => {
  it('OrbitalBackground.tsx never imports or renders HelenaOrbital in real code (the header comment discusses the relationship in prose, which is fine — no import/JSX usage is)', () => {
    expect(orbitalBackgroundCode).not.toContain('HelenaOrbital')
  })

  it('HelenaOrbital.tsx is untouched by this phase — never imports OrbitalBackground, keeps its own independent stateful motion system', () => {
    expect(helenaOrbitalSource).not.toContain('OrbitalBackground')
    expect(helenaOrbitalSource).toMatch(/export type HelenaVisualState/)
  })
})

describe('Surface adoption — login', () => {
  it('login uses OrbitalBackground and no longer imports the old decorative idle HlnaOrb', () => {
    expect(loginSource).toContain("import { OrbitalBackground } from '@/components/brand/OrbitalBackground'")
    expect(loginSource).toMatch(/<OrbitalBackground/)
    expect(loginSource).not.toMatch(/import \{ HlnaOrb \} from '@\/components\/brand\/HlnaOrb'/)
    expect(loginSource).not.toContain('<HlnaOrb')
  })

  it('the sign-in form remains present and unaffected (still renders username/password/submit)', () => {
    expect(loginSource).toMatch(/name="username"|id="username"/)
    expect(loginSource).toMatch(/type="password"/)
  })
})

describe('Surface adoption — signup', () => {
  it('signup reuses the shared OrbitalBackground (mirrors login, not a duplicated bespoke implementation) and drops the old decorative HlnaOrb', () => {
    expect(signupSource).toContain("import { OrbitalBackground } from '@/components/brand/OrbitalBackground'")
    expect(signupSource).toMatch(/<OrbitalBackground/)
    expect(signupSource).not.toMatch(/import \{ HlnaOrb \} from '@\/components\/brand\/HlnaOrb'/)
    expect(signupSource).not.toContain('<HlnaOrb')
  })

  it('does not duplicate OrbitalBackground\'s own CSS/keyframes locally — reuses the shared component instead', () => {
    expect(signupSource).not.toMatch(/bbOrbitalRingSpin/)
  })
})

describe('Surface adoption — homepage', () => {
  it('homepage hero uses OrbitalBackground, replacing the old plain page-wide radial-gradient wash', () => {
    expect(homepageSource).toContain("import { OrbitalBackground } from '@/components/brand/OrbitalBackground'")
    expect(homepageSource).toMatch(/<OrbitalBackground/)
  })

  it('is scoped to the hero section (not a page-wide fixed layer) so content further down the page stays clean, per the "not every page has a giant glowing orb" acceptance bar', () => {
    const heroStart = homepageSource.indexOf("className=\"bb-home-hero\"")
    const orbitalIdx = homepageSource.indexOf('<OrbitalBackground', heroStart)
    expect(heroStart).toBeGreaterThan(-1)
    expect(orbitalIdx).toBeGreaterThan(heroStart)
    // Only one usage on the whole homepage.
    expect((homepageSource.match(/<OrbitalBackground/g) ?? []).length).toBe(1)
  })

  // Updated during Phase D.3.1: a content-safe mask div (also
  // aria-hidden/pointer-events:none, part of the same stacking level as
  // OrbitalBackground) was inserted between OrbitalBackground and the
  // content wrapper, so the wrapper is no longer within a fixed small
  // window right after the <OrbitalBackground> tag — anchored on the
  // bb-home-hero-inner class instead, which is the actual element that
  // needs (and has) the explicit stacking context.
  it('the hero content wrapper is explicitly given its own stacking context (position+zIndex) above the background — otherwise an absolutely-positioned background sibling paints above unpositioned normal-flow content', () => {
    // className="bb-home-hero-inner" (the JSX usage), not the earlier bare
    // ".bb-home-hero-inner" CSS-selector text inside the KEYFRAMES constant
    // defined above the component.
    const innerIdx = homepageSource.indexOf('className="bb-home-hero-inner"')
    expect(innerIdx, 'expected a bb-home-hero-inner JSX element').toBeGreaterThan(-1)
    const innerRegion = homepageSource.slice(innerIdx, innerIdx + 400)
    expect(innerRegion).toMatch(/position:\s*'relative'/)
    expect(innerRegion).toMatch(/zIndex:\s*1/)
  })
})

describe('Surface adoption — connect', () => {
  it('connect uses the quiet "veil" variant (not "field") — a minimal single-purpose card page, per the "do not overdesign" instruction', () => {
    expect(connectSource).toContain("import { OrbitalBackground } from '@/components/brand/OrbitalBackground'")
    expect(connectSource).toMatch(/<OrbitalBackground[\s\S]{0,80}variant="veil"/)
  })

  it('the page-specific wordmark-framing glow (.bb-connect-glow) is left untouched — that is a deliberate local accent, not the atmospheric background this phase targets', () => {
    expect(connectSource).toContain('bb-connect-glow')
  })
})

describe('Surfaces deliberately NOT adopted this phase', () => {
  it('request-demo keeps its existing bespoke quiet background — already lighter/purpose-built, not forced onto OrbitalBackground', () => {
    expect(requestDemoSource).not.toContain('OrbitalBackground')
  })

  it('/hlna and HelenaWorkspace are untouched — the workspace already has its own state-reactive atmosphere tightly coupled to HelenaOrbital, and layering an unrelated decorative background risks exactly the "competing visual" this phase must avoid', () => {
    expect(hlnaPageSource).not.toContain('OrbitalBackground')
    expect(helenaWorkspaceSource).not.toContain('OrbitalBackground')
    expect(helenaWorkspaceSource).toContain('HelenaOrbital')
  })

  it('OrganisationDashboard is untouched — a dense operational/data screen, and (unlike OrbitalBackground, which is dark-surface-only) it participates in the light/dark theme token system', () => {
    expect(organisationDashboardSource).not.toContain('OrbitalBackground')
    expect(organisationDashboardSource).toContain('var(--bg-base)')
  })
})

describe('No heavy rendering dependency introduced', () => {
  it('package.json is byte-for-byte unchanged this phase (this repo already has a pre-existing "three" dependency, used elsewhere and predating D.3 — the containment guarantee that matters is that D.3 added nothing, not that "three" is absent from the repo entirely)', () => {
    const dependencies = JSON.parse(packageJson).dependencies ?? {}
    const devDependencies = JSON.parse(packageJson).devDependencies ?? {}
    for (const dep of ['pixi.js', 'react-three-fiber', '@react-three/fiber', 'framer-motion', 'motion', 'gsap', 'react-spring']) {
      expect(dependencies).not.toHaveProperty(dep)
      expect(devDependencies).not.toHaveProperty(dep)
    }
  })

  it('OrbitalBackground itself imports no 3D/animation library, and uses no <canvas>/WebGL context', () => {
    expect(orbitalBackgroundCode).not.toMatch(/from ['"](three|framer-motion|gsap|@react-three\/fiber)['"]|getContext\(['"]webgl/)
    expect(orbitalBackgroundCode).not.toContain('<canvas')
  })
})
