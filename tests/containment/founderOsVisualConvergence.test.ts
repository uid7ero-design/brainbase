import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Founder OS visual-convergence guard (authenticated visual-completion
// pass, phase P2). Founder OS used to be a separate, dark-only mini-app:
// a private hex palette (#07080B / #0B0C12 / #0F1018 / #EEEEF0), white-alpha
// neutrals, the retired violet chrome, neon glow dots, a photo gradient,
// forced-dark date inputs, local Inter font stacks, and hand-rolled
// overlays / clickable <div>s with no dialog or button semantics.
//
// This guard blocks those treatments from returning to the Founder OS
// surface while leaving the ONE documented data encoding alone: the CRM
// pipeline stage hue map (STAGE_FG — mirrored in
// app/admin/orgs/AdminClient.tsx), which is removed from the source before
// the colour checks run and is itself pinned to exactly one declaration.
// Comments are stripped first so history notes may still name old values.

const PAGE = 'app/admin/founder/page.tsx'
const INSTAGRAM = 'components/instagram/InstagramFeedPanel.tsx'
const CSS = 'components/founder/FounderOs.module.css'
const FILES = [PAGE, INSTAGRAM, CSS]

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
}

// Whole-line // comments go first: a line comment may itself contain "/*"
// (e.g. a path glob such as app/api/founder/tasks/**), which would otherwise
// open a bogus block comment and swallow real code.
function stripComments(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const STAGE_MAP_LINE = /^const STAGE_FG: {2}Record<Stage, string> {3}= \{[^\n]*\};$/m

/** Source with comments stripped and the documented stage-hue data map removed. */
function surface(rel: string): string {
  return stripComments(read(rel)).replace(STAGE_MAP_LINE, '')
}

const OLD_VIOLET = /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|a5b4fc|818CF8|6366F1)\b|rgba?\(\s*(139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|124\s*,\s*58\s*,\s*237|99\s*,\s*102\s*,\s*241)/i
const WHITE_ALPHA = /rgba?\(\s*255\s*,\s*255\s*,\s*255/i
const DARK_SLABS = /#(07080B|0B0C12|0F1018|EEEEF0)\b/i
const ANY_HEX = /#[0-9a-f]{3,8}\b/i

describe('Founder OS — the documented stage-hue data map is the only colour literal', () => {
  it('STAGE_FG is declared exactly once, as a single-line data map', () => {
    const matches = stripComments(read(PAGE)).match(new RegExp(STAGE_MAP_LINE.source, 'gm')) ?? []
    expect(matches).toHaveLength(1)
  })

  for (const rel of FILES) {
    it(`${rel}: no hex colour literal outside the stage map`, () => {
      expect(surface(rel)).not.toMatch(ANY_HEX)
    })
    it(`${rel}: no old violet chrome`, () => {
      expect(surface(rel)).not.toMatch(OLD_VIOLET)
    })
    it(`${rel}: no white-alpha neutrals or dark slab colours`, () => {
      const src = surface(rel)
      expect(src).not.toMatch(WHITE_ALPHA)
      expect(src).not.toMatch(DARK_SLABS)
      expect(src).not.toMatch(/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,/)
    })
  }
})

describe('Founder OS — no forced dark, glow, glass, gradient, outline suppression or legacy fonts', () => {
  for (const rel of FILES) {
    it(`${rel}: no colorScheme / color-scheme override`, () => {
      expect(surface(rel)).not.toMatch(/colorScheme\s*:|color-scheme\s*:/)
    })
    it(`${rel}: no glow box-shadow (0 0 Npx) and no backdrop blur`, () => {
      const src = surface(rel)
      expect(src).not.toMatch(/(boxShadow|box-shadow)[^;\n]*\b0 0 \d+px/)
      expect(src).not.toMatch(/backdropFilter|backdrop-filter/)
    })
    it(`${rel}: no decorative gradient`, () => {
      expect(surface(rel)).not.toMatch(/gradient\(/)
    })
    it(`${rel}: no outline suppression`, () => {
      expect(surface(rel)).not.toMatch(/outline\s*:\s*['"]?(none|0)\b/)
    })
    it(`${rel}: no local font stacks (var(--font-inter) / Inter / Geist literals)`, () => {
      const src = surface(rel)
      expect(src).not.toContain('var(--font-inter)')
      expect(src).not.toMatch(/fontFamily\s*:\s*['"][^'"]*(Inter|Geist|monospace)/)
      expect(src).not.toMatch(/font-family\s*:\s*[^;]*(Inter|Geist|monospace)/)
    })
  }

  it('the private dark palette T now resolves to theme tokens only', () => {
    const src = surface(PAGE)
    const block = src.match(/const T = \{([\s\S]*?)\} as const;/)
    expect(block).not.toBeNull()
    const values = [...block![1].matchAll(/:\s*'([^']*)'/g)].map(m => m[1])
    expect(values.length).toBeGreaterThan(10)
    for (const v of values) expect(v).toMatch(/^var\(--[a-z0-9-]+\)$/)
  })
})

describe('Founder OS — interaction semantics', () => {
  const page = surface(PAGE)

  function body(name: string): string {
    const start = page.indexOf(`function ${name}(`)
    expect(start, `function ${name} not found`).toBeGreaterThan(-1)
    const next = page.indexOf('\nfunction ', start + 10)
    return page.slice(start, next < 0 ? undefined : next)
  }

  it('the three modals render through the shared Dialog (role="dialog", Escape, focus trap/return)', () => {
    for (const name of ['AddLeadModal', 'BookDemoModal', 'ProposalModal']) {
      expect(body(name)).toMatch(/<Dialog\s+open\s+onClose=\{onClose\}\s+title="/)
    }
  })

  it('the client drawer renders through the shared SlidePanel', () => {
    expect(body('ClientDrawer')).toMatch(/<SlidePanel\s+open\s+onClose=\{onClose\}/)
  })

  it('no hand-rolled fixed overlays or clickable <div>s remain', () => {
    expect(page).not.toMatch(/position:\s*'fixed'/)
    expect(page).not.toMatch(/<div\b[^>]*\sonClick=/)
    expect(page).not.toMatch(/onMouseEnter|onMouseLeave/)
  })

  it('sidebar nav items are real buttons / links on the shared module-nav contract', () => {
    const sidebar = body('LeftSidebar')
    expect(sidebar).toContain('<nav')
    expect(sidebar).toContain('moduleNavItemProps(active)')
    expect(sidebar).toMatch(/<button\s+type="button"[\s\S]*?aria-current=\{item\['aria-current'\]\}/)
    expect(sidebar).toMatch(/<Link href=\{n\.href/)
  })

  it('section tabs expose their state with aria-pressed', () => {
    expect(body('SectionTabs')).toContain('aria-pressed={section === t.id}')
  })

  it('the toast is announced (role status / alert)', () => {
    expect(body('Toast')).toMatch(/role=\{isError \? 'alert' : 'status'\}/)
  })
})

// Decision (authenticated visual-completion pass): severity is semantic —
// red for high / critical / urgent, amber for medium, neutral for low.
// Purple is product/selection identity and never a severity.
describe('Founder OS severity colours are semantic', () => {
  it('maps high/critical to danger, medium to warning, low to neutral', () => {
    const src = surface(PAGE)
    expect(src).toContain("const HIGH = 'var(--status-danger)';")
    expect(src).toContain('const SEV_COLOR: Record<Severity, string> = { critical: T.red, high: HIGH, medium: T.yellow, low: T.inactive };')
    expect(src).toContain('Critical: T.red, High: HIGH, Medium: T.yellow, Low: T.dim,')
    expect(src).toMatch(/red:\s*'var\(--status-danger\)'/)
    expect(src).toMatch(/yellow:\s*'var\(--status-warning\)'/)
    for (const map of ['SEV_COLOR', 'TASK_PRIORITY_COLOR', 'ATTN_TYPE_COLOR']) {
      const i = src.indexOf(`const ${map}`)
      const block = src.slice(i, src.indexOf('}', i) + 1)
      expect(block, map).not.toMatch(/T\.purple|brand-brainbase-accent/)
    }
  })
})
