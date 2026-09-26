import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

// Public-site visual convergence — static containment for the invariants
// the rendered tests in tests/components/ cannot see (CSS, theme wiring,
// scope boundaries). Rendered accessibility behaviour is covered there.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const tokens = read('styles/brainbase-tokens.css')
const globals = read('app/globals.css')
const layout = read('app/layout.tsx')
const homepage = stripComments(read('app/page.tsx'))
const cssModules = [
  'components/public/public.module.css',
  'components/public/PublicNav.module.css',
  'components/public/PublicFooter.module.css',
  'components/public/SystemMap.module.css',
  'components/public/home/home.module.css',
  'components/ui/semantic/semantic.module.css',
].map(p => [p, read(p)] as const)

function block(src: string, selector: string) {
  const start = src.indexOf(selector)
  expect(start, `${selector} block`).toBeGreaterThan(-1)
  return src.slice(start, src.indexOf('\n}', start))
}

describe('Design tokens', () => {
  it('are imported once, globally, after Tailwind', () => {
    expect(globals).toMatch(/@import "tailwindcss";\n@import "\.\.\/styles\/brainbase-tokens\.css";/)
  })

  it('coexist with the authenticated-app token foundation and its compatibility aliases', () => {
    expect(globals).toContain('--bb-canvas: #07080B;')
    expect(globals).toContain('--bg-base: var(--bb-canvas);')
    expect(globals).toContain(":root[data-theme='light'] {")
    expect(tokens).not.toMatch(/--(bg-base|bg-surface|text-primary|purple-\d+):/)
    expect(tokens).toContain(':root .bb-public,')
    expect(tokens).toContain(':root .bb-scope-dark {')
    expect(tokens).toContain(":root[data-theme='light'] .bb-public,")
    expect(tokens).toContain(':root .bb-scope-light {')
  })

  it('define every surface/text/accent token for both themes', () => {
    const dark = block(tokens, ':root,\n.bb-scope-dark {')
    const light = block(tokens, ":root[data-theme='light'],\n.bb-scope-light {")
    for (const name of [
      'bg', 'bg-subtle', 'surface', 'surface-raised', 'surface-strong',
      'text', 'text-muted', 'text-subtle', 'border', 'border-strong', 'grid',
      'accent', 'accent-hover', 'accent-soft', 'accent-border',
      'signal', 'signal-hover', 'signal-soft', 'signal-border', 'focus',
    ]) {
      expect(dark, `dark --bb-${name}`).toMatch(new RegExp(`--bb-${name}:`))
      expect(light, `light --bb-${name}`).toMatch(new RegExp(`--bb-${name}:`))
    }
  })

  it('define all seven semantic states (fg/dot/soft/border) for both themes', () => {
    const dark = block(tokens, ':root,\n.bb-scope-dark {')
    const light = block(tokens, ":root[data-theme='light'],\n.bb-scope-light {")
    for (const state of ['success', 'warning', 'error', 'info', 'active', 'inactive', 'syncing']) {
      for (const part of ['fg', 'dot', 'soft', 'border']) {
        expect(dark).toMatch(new RegExp(`--bb-${state}-${part}:`))
        expect(light).toMatch(new RegExp(`--bb-${state}-${part}:`))
      }
    }
  })

  it('carry the specified purple/cyan scales and light/dark base values', () => {
    expect(tokens).toContain('--bb-purple-600: #7440e8;')
    expect(tokens).toContain('--bb-cyan-400: #22c7e8;')
    expect(tokens).toContain('--bb-bg: #f7f6f2;')
    expect(tokens).toContain('--bb-bg: #0d0d12;')
  })
})

describe('Theme wiring is unchanged', () => {
  it('the pre-paint init script still reads bb-theme and defaults to dark (no flash)', () => {
    expect(layout).toContain('var theme = localStorage.getItem("bb-theme");')
    expect(layout).toMatch(/data-theme="dark"/)
    expect(layout).toContain('id="brainbase-theme-init"')
  })

  it('the public toggle uses the existing ThemeProvider (same storage key), not a second mechanism', () => {
    const toggle = stripComments(read('components/public/ThemeToggle.tsx'))
    expect(toggle).toContain("import { useTheme } from '@/components/theme/ThemeProvider'")
    expect(toggle).not.toMatch(/localStorage/)
  })
})

describe('Homepage is theme-aware and calmer', () => {
  it('has no hardcoded colours — every colour comes from a --bb-* token', () => {
    expect(homepage).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(homepage).not.toMatch(/rgba?\(/)
    expect(read('components/public/home/home.module.css')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
  })

  it('is a server component (no page-level "use client")', () => {
    expect(read('app/page.tsx').trimStart().startsWith("'use client'")).toBe(false)
  })

  it('no longer layers the fixed page-level OrbitalBackground / HeroOrbitMark atmosphere', () => {
    expect(homepage).not.toMatch(/OrbitalBackground|HeroOrbitMark/)
    expect(homepage).toMatch(/<SystemMap/)
  })

  it('keeps the interactive HLNA query box', () => {
    expect(homepage).toMatch(/<CommandDemo placeholder="Ask BrainBase what's happening across your operation\.\.\." \/>/)
  })

  it('only themed routes get the theme toggle; other public pages pin the nav to dark', () => {
    const routes = read('components/public/routes.ts')
    for (const route of ['/', '/pricing', '/client-operations', '/client-operations/demo', '/web-systems', '/demo', '/request-demo', '/privacy', '/terms']) {
      expect(routes).toContain(`  '${route}',`)
    }
    // Exact-match only: any unconverted route (e.g. /login) keeps the dark nav.
    expect(routes).toMatch(/THEMED_PUBLIC_ROUTES\.includes\(pathname\)/)
    const nav = stripComments(read('components/public/PublicNav.tsx'))
    expect(nav).toMatch(/themed \? '' : 'bb-scope-dark'/)
    expect(nav).toMatch(/\{themed && <ThemeToggle \/>\}/)
  })
})

describe('Motion and focus', () => {
  it('every stylesheet that animates or transitions has a prefers-reduced-motion rule', () => {
    for (const [file, css] of cssModules) {
      if (/animation:|transition:/.test(css)) {
        expect(css, file).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
      }
    }
  })

  it('interactive public elements define a visible :focus-visible outline from the focus token', () => {
    for (const file of [
      'components/public/PublicNav.module.css',
      'components/public/PublicFooter.module.css',
      'components/ui/semantic/semantic.module.css',
      'components/public/home/home.module.css',
    ]) {
      expect(read(file), file).toMatch(/:focus-visible[^{]*\{\s*outline: 2px solid var\(--bb-focus\)/)
    }
    expect(tokens).toMatch(/\.bb-public :focus-visible,\n\.bb-semantic :focus-visible \{\n\s*outline: 2px solid var\(--bb-focus\);/)
  })
})

describe('Scope boundary — the logged-in application is untouched', () => {
  it('TopNav only swapped its inline PublicNav for the extracted component; AppNav remains', () => {
    const topNav = stripComments(read('components/nav/TopNav.tsx'))
    expect(topNav).toContain("import { PublicNav } from '@/components/public/PublicNav';")
    expect(topNav).not.toMatch(/function PublicNav\(/)
    expect(topNav).toMatch(/function AppNav\(/)
    expect(topNav).toMatch(/<AppNav\s/)
  })

  it('the dark-only BrainBaseWordmark used by the app is unchanged', () => {
    expect(read('components/brand/BrainBaseWordmark.tsx')).toContain('src="/Brand/brainbase-horizontal-color.svg"')
  })
})

// Equivalents for the durable behaviours the retired fixed-atmosphere
// homepage tests (homepageHeroRefinement / homepagePersistentAtmosphere /
// orbitalBackground homepage block) protected, expressed against the new
// structure. Decorative-layer semantics, footer content and section copy
// are covered by the rendered tests in tests/components/public/.
describe('Homepage layout safety (replaces retired atmosphere-structure checks)', () => {
  const homeCss = read('components/public/home/home.module.css')
  const publicCss = read('components/public/public.module.css')

  it('one orbital visual system only: SystemMap appears once and no competing hero artwork remains', () => {
    expect((homepage.match(/<SystemMap/g) ?? []).length).toBe(1)
    expect(homepage).not.toMatch(/hlna-orb-only\.webp|orbFloat|glowPulse/)
  })

  it('hero content sits in its own stacking context above the non-interactive decorative fade', () => {
    expect(block(homeCss, '.hero::after {')).toContain('pointer-events: none;')
    expect(block(homeCss, '.heroGrid {')).toMatch(/position: relative;\s*z-index: 1;/)
  })

  it('readable width is constrained by the shared container', () => {
    expect(tokens).toContain('--bb-container: 1200px;')
    expect(block(publicCss, '.container {')).toContain('max-width: var(--bb-container);')
  })

  it('no horizontal overflow: the page clips x-overflow and every fractional grid track can shrink', () => {
    expect(block(publicCss, '.page {')).toContain('overflow-x: clip;')
    const tracks = [...homeCss.matchAll(/grid-template-columns: ([^;]+);/g)].map(m => m[1])
    expect(tracks.length).toBeGreaterThan(5)
    for (const t of tracks) {
      // Bare `1fr` has an auto minimum and can overflow; minmax(0, 1fr) cannot.
      expect(t.replace(/minmax\(0, [\d.]+fr\)/g, ''), t).not.toMatch(/\bfr\b|\d+fr/)
    }
  })

  it('multi-column sections collapse at narrow widths', () => {
    expect(homeCss).toMatch(/@media \(max-width: 1024px\) \{\s*\.heroGrid \{\s*grid-template-columns: minmax\(0, 1fr\);/)
    expect(homeCss).toMatch(/@media \(max-width: 560px\) \{[\s\S]*?\.capabilityGrid,[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/)
  })

  // Found in the 375px browser sweep: a scroll container without a
  // positioning context let its visually-hidden (position:absolute) cell
  // text escape to the viewport and widen the whole page.
  it('every public scroll container is a containing block for absolutely-positioned descendants', () => {
    const dir = path.join(root, 'components/public')
    const files = fs
      .readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter(f => f.endsWith('.module.css'))
    expect(files.length).toBeGreaterThan(5)
    for (const f of files) {
      const css = read(path.join('components/public', f))
      for (const m of css.matchAll(/\n([^\n{}]+)\{([^}]*overflow(?:-x)?:\s*(?:auto|scroll)[^}]*)\}/g)) {
        expect(m[2], `${f} ${m[1].trim()}`).toMatch(/position:\s*(relative|absolute|fixed|sticky)/)
      }
    }
  })

  it('the platform map is hidden on phones rather than squeezed to unreadable text', () => {
    expect(homeCss).toMatch(/@media \(max-width: 560px\) \{\s*\.mapPanel \{\s*display: none;/)
  })
})
