import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

// Phase A — authenticated design foundation. Protects the semantic token
// contract in app/globals.css: every token exists in both themes, resolves
// to a real colour, and text / boundary / focus tokens meet WCAG contrast
// against the surfaces they sit on. Values are resolved through var()
// chains (app tokens → --bb-* tokens → --bb-cyan-* scale) per theme, so the
// test checks what the browser would actually paint, not the source text.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const globals = read('app/globals.css')
const publicTokens = read('styles/brainbase-tokens.css')

function block(src: string, opener: string): string {
  const start = src.indexOf(opener)
  expect(start, `block ${opener}`).toBeGreaterThan(-1)
  return src.slice(start, src.indexOf('\n}', start))
}
function decls(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const appDark = decls(block(globals, ':root {'))
const appLight = decls(block(globals, ":root[data-theme='light'] {"))
const bbRoot = decls(block(publicTokens, ':root {'))
const bbDark = decls(block(publicTokens, ':root,\n.bb-scope-dark {'))
const bbLight = decls(block(publicTokens, ":root[data-theme='light'],\n.bb-scope-light {"))

const theme = {
  dark: [appDark, bbDark, bbRoot],
  light: [appLight, appDark, bbLight, bbDark, bbRoot],
} as const
type Theme = keyof typeof theme

function resolve(name: string, t: Theme, depth = 0): string {
  expect(depth, `var() cycle at ${name}`).toBeLessThan(10)
  const scope = theme[t].find(s => name in s)
  expect(scope, `${name} is defined for ${t}`).toBeDefined()
  const value = scope![name]
  const ref = value.match(/^var\((--[\w-]+)\)$/)
  return ref ? resolve(ref[1], t, depth + 1) : value
}

type RGB = [number, number, number]
function parseColour(v: string): { rgb: RGB; a: number } {
  const hex = v.match(/^#([0-9a-f]{6})$/i)
  if (hex) return { rgb: [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)) as RGB, a: 1 }
  const rgba = v.match(/^rgba?\(([^)]+)\)$/)
  expect(rgba, `colour value ${v}`).not.toBeNull()
  const [r, g, b, a = '1'] = rgba![1].split(',').map(s => s.trim())
  return { rgb: [Number(r), Number(g), Number(b)], a: Number(a) }
}
function over(fg: string, bg: string): RGB {
  const f = parseColour(fg)
  const b = parseColour(bg).rgb
  return f.rgb.map((c, i) => c * f.a + b[i] * (1 - f.a)) as RGB
}
function lum([r, g, b]: RGB) {
  const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(fg: string, bg: string, t: Theme): number {
  const base = resolve('--bg-base', t)
  const bgRGB = over(bg, base)
  const bgHex = `rgb(${bgRGB.map(Math.round).join(',')})`
  const fgRGB = over(fg, bgHex)
  const [x, y] = [lum(fgRGB), lum(bgRGB)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const REQUIRED = [
  '--bg-base', '--bg-surface', '--bg-raised', '--bg-sunken', '--bg-overlay',
  '--border', '--border-light', '--border-strong', '--border-focus',
  '--text-primary', '--text-secondary', '--text-muted', '--text-subtle',
  '--brand-brainbase-accent', '--brand-brainbase-accent-hover', '--brand-brainbase-accent-muted', '--brand-brainbase-accent-border', '--brand-brainbase-on-accent',
  '--status-success', '--status-success-muted', '--status-warning', '--status-warning-muted',
  '--status-danger', '--status-danger-muted', '--status-info', '--status-info-muted', '--status-inactive',
  '--focus-ring-color', '--focus-ring-width', '--focus-ring-offset',
  '--radius-sm', '--radius-md', '--radius-lg',
  '--shadow-menu', '--shadow-popover', '--shadow-dialog', '--scrim',
]
const SURFACES = ['--bg-base', '--bg-surface', '--bg-raised', '--bg-sunken', '--bg-overlay']
const THEMES: Theme[] = ['dark', 'light']

describe('Authenticated semantic token contract (app/globals.css)', () => {
  it.each(THEMES)('every semantic token is defined for the %s theme', t => {
    for (const name of REQUIRED) expect(resolve(name, t), name).toBeTruthy()
  })

  it('locked foundation values are unchanged', () => {
    expect(resolve('--bg-base', 'light')).toBe('#F5F3EE')
    expect(resolve('--bg-base', 'dark')).toBe('#0B0B0C')
    expect(resolve('--text-primary', 'light')).toBe('#15171B')
    expect(resolve('--text-primary', 'dark')).toBe('#F3EEE6')
    expect(resolve('--brand-brainbase-accent', 'light')).toBe('#6D4CD6')
    expect(resolve('--brand-brainbase-accent', 'dark')).toBe('#9B7BFF')
  })

  it.each(THEMES)('primary, secondary and muted text meet 4.5:1 on every %s surface', t => {
    for (const text of ['--text-primary', '--text-secondary', '--text-muted']) {
      for (const surface of SURFACES) {
        const ratio = contrast(resolve(text, t), resolve(surface, t), t)
        expect(ratio, `${text} on ${surface} (${t}) = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it.each(THEMES)('--text-subtle and --border-strong meet 3:1 non-text contrast on the %s base', t => {
    for (const name of ['--text-subtle', '--border-strong']) {
      const ratio = contrast(resolve(name, t), resolve('--bg-base', t), t)
      expect(ratio, `${name} (${t}) = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3)
    }
  })

  it.each(THEMES)('status foregrounds meet 4.5:1 on the %s base, surface and their own muted fill', t => {
    for (const s of ['success', 'warning', 'danger', 'info']) {
      const fg = resolve(`--status-${s}`, t)
      for (const bg of [resolve('--bg-base', t), resolve('--bg-surface', t), resolve(`--status-${s}-muted`, t)]) {
        const ratio = contrast(fg, bg, t)
        expect(ratio, `--status-${s} (${t}) = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    expect(contrast(resolve('--status-inactive', t), resolve('--bg-base', t), t)).toBeGreaterThanOrEqual(4.5)
  })

  it('status states stay semantically distinct: info/sync is not product purple, danger is not accent', () => {
    for (const t of THEMES) {
      const accent = resolve('--brand-brainbase-accent', t).toLowerCase()
      for (const s of ['success', 'warning', 'danger', 'info', 'inactive']) {
        expect(resolve(`--status-${s}`, t).toLowerCase(), `${s} (${t})`).not.toBe(accent)
      }
      const fgs = ['success', 'warning', 'danger', 'info'].map(s => resolve(`--status-${s}`, t).toLowerCase())
      expect(new Set(fgs).size).toBe(4)
    }
  })

  it.each(THEMES)('primary-button label (on-accent) meets 4.5:1 on the %s accent and its hover', t => {
    for (const bg of ['--brand-brainbase-accent', '--brand-brainbase-accent-hover']) {
      if (t === 'light' || bg === '--brand-brainbase-accent') {
        const ratio = contrast(resolve('--brand-brainbase-on-accent', t), resolve(bg, t), t)
        expect(ratio, `on-accent on ${bg} (${t}) = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it.each(THEMES)('the focus ring is the product accent and meets 3:1 on every %s surface', t => {
    expect(resolve('--focus-ring-color', t)).toBe(resolve('--brand-brainbase-accent', t))
    expect(resolve('--border-focus', t)).toBe(resolve('--brand-brainbase-accent', t))
    for (const surface of SURFACES) {
      const ratio = contrast(resolve('--focus-ring-color', t), resolve(surface, t), t)
      expect(ratio, `focus on ${surface} (${t}) = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('the pre-brand violet focus value is gone from the app token layer', () => {
    expect(globals).not.toMatch(/rgba\(124,\s*58,\s*237/)
  })
})

describe('Global keyboard focus treatment', () => {
  it('a zero-specificity :focus-visible rule draws the token focus ring', () => {
    expect(globals).toMatch(
      /:where\(:focus-visible\)\s*\{\s*outline:\s*var\(--focus-ring-width\)\s+solid\s+var\(--focus-ring-color\);\s*outline-offset:\s*var\(--focus-ring-offset\);\s*\}/,
    )
  })

  it('it does not suppress focus anywhere globally (no bare outline:none / :focus reset in globals.css)', () => {
    expect(globals.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/outline:\s*(none|0)\b/)
  })
})

describe('Semantic status primitives are fit for the signed-in app', () => {
  it.each(THEMES)('the active state uses the locked product accent (%s)', t => {
    const scope = t === 'dark' ? bbDark : bbLight
    expect(scope['--bb-active-fg'].toLowerCase()).toBe(resolve('--brand-brainbase-accent', t).toLowerCase())
    expect(scope['--bb-active-dot'].toLowerCase()).toBe(resolve('--brand-brainbase-accent', t).toLowerCase())
  })

  it('semantic components inherit the surrounding typeface (Inter in the app, Geist on the public site)', () => {
    const css = read('components/ui/semantic/semantic.module.css')
    const stateful = css.slice(css.indexOf('.stateful {'), css.indexOf('}', css.indexOf('.stateful {')))
    expect(stateful).toContain('font-family: inherit;')
  })
})
