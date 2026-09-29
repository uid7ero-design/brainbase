import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

// Remaining authenticated visual islands pass — worker A guard.
//
// Surfaces: the global session lock screen (components/session/LockScreen,
// mounted by SessionProvider for every signed-in page), and the super-admin
// Web Systems pipeline, Deployment operations, Agent runs and
// Administration pages. Each was a dark-only island (or carried residue):
// white-alpha neutrals, near-black slabs, retired violet chrome, glass /
// blur, decorative gradients and glows, local font stacks and outline
// suppression. This guard keeps those treatments out while allowing ONLY
// the documented data encodings:
//   - pipeline stage / proposal type / onboarding stage / agent identity
//     hues, declared once per theme as --stage-* / --dep-* / --agent-*
//     custom properties in the surfaces' own CSS modules (and each pinned
//     to >= 3:1 against the surface it sits on, below);
//   - the Founder CRM stage map (STAGE_C) in AdminClient, shared with
//     Founder OS (STAGE_FG), pinned to exactly one declaration.
// Comments are stripped first so history notes may still name old values.
// The preserved behaviour each surface depends on is pinned at the end.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')

function stripComments(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

const TSX = [
  'components/session/LockScreen.tsx',
  'app/admin/web-services/page.tsx',
  'app/admin/web-services/LeadMessages.tsx',
  'app/admin/deployments/page.tsx',
  'app/admin/agent-runs/AgentRunsDashboard.tsx',
  'app/admin/orgs/AdminClient.tsx',
]
const CSS = [
  'components/session/LockScreen.module.css',
  'app/admin/web-services/WebServices.module.css',
  'app/admin/web-services/LeadMessages.module.css',
  'app/admin/deployments/Deployments.module.css',
  'app/admin/agent-runs/AgentRuns.module.css',
]

// Documented encodings: one custom-property declaration per line.
const HUE_DECL = /^\s*--(stage|dep|agent)-[a-z-]+:\s*#[0-9a-f]{6};\s*$/gm
const STAGE_C_LINE = /^\s*const STAGE_C: Record<string, string> = \{[^\n]*\};\s*$/gm

function code(file: string): string {
  return stripComments(read(file)).replace(HUE_DECL, '').replace(STAGE_C_LINE, '')
}

const WHITE_ALPHA = /rgba?\(\s*2[2-5]\d\s*,\s*2[2-5]\d\s*,\s*2[2-5]\d\s*,|#fff(fff)?\b|#F5F7FA|#F0F2F5|#F4F4F5/i
const DARK_SURFACE = /#(07080B|08090C|0a0a0f|0e1014|13131a|1a1d24|0B0C12|0F1018|111113|1f2937)\b|rgba\(\s*(7\s*,\s*8\s*,\s*11|8\s*,\s*9\s*,\s*12|9\s*,\s*10\s*,\s*14|17\s*,\s*17\s*,\s*30|13\s*,\s*13\s*,\s*21)\s*,/i
const OLD_VIOLET = /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|a5b4fc|818CF8|6366F1|C084FC)\b|rgba?\(\s*(139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|124\s*,\s*58\s*,\s*237|99\s*,\s*102\s*,\s*241|109\s*,\s*40\s*,\s*217)\b/i
const COLOR_SCHEME_DARK = /colorScheme\s*:\s*['"]dark|color-scheme\s*:\s*dark/
const OUTLINE_SUPPRESSION = /outline\s*:\s*['"]?\s*(none|0)\b/
const GLASS = /backdrop-?filter|\bblur\(/i
const GRADIENT = /(linear|radial|conic)-gradient/
const GLOW = /(box-?shadow|boxShadow)\s*:\s*[`'"]?\s*0 0 \d/i
const FONT_STACK = /--font-inter|--font-geist-sans|['"]Inter['"]|fontFamily\s*:\s*(FONT|['"]monospace['"])|\bconst FONT\b/
const TAILWIND_DARK = /\b(text-white|bg-black|bg-\[#0|text-white\/|border-white\/)/
const HEX = /#[0-9a-fA-F]{3,8}\b/
const RGBA = /\brgba?\(/

describe('Remaining visual islands (A) — no dark-only chrome on the converged surfaces', () => {
  for (const file of [...TSX, ...CSS]) {
    it(`${file}: no white-alpha, dark slabs, retired violet, dark colour-scheme, glass, gradients, glows, local font stacks or Tailwind dark classes`, () => {
      const c = code(file)
      expect(c).not.toMatch(WHITE_ALPHA)
      expect(c).not.toMatch(DARK_SURFACE)
      expect(c).not.toMatch(OLD_VIOLET)
      expect(c).not.toMatch(COLOR_SCHEME_DARK)
      expect(c).not.toMatch(GLASS)
      expect(c).not.toMatch(GRADIENT)
      expect(c).not.toMatch(GLOW)
      expect(c).not.toMatch(FONT_STACK)
      expect(c).not.toMatch(TAILWIND_DARK)
    })

    it(`${file}: no outline suppression (the global :focus-visible ring stays)`, () => {
      expect(code(file)).not.toMatch(OUTLINE_SUPPRESSION)
    })

    it(`${file}: no raw colour literals outside the documented encodings`, () => {
      const c = code(file)
      expect(c).not.toMatch(HEX)
      expect(c).not.toMatch(RGBA)
    })
  }

  it('AdminClient keeps exactly one STAGE_C declaration (shared with Founder OS STAGE_FG) and renders the stage label on --text-primary', () => {
    const src = stripComments(read('app/admin/orgs/AdminClient.tsx'))
    expect(src.match(STAGE_C_LINE)).toHaveLength(1)
    const founder = read('app/admin/founder/page.tsx')
    const fg = founder.match(/const STAGE_FG: {2}Record<Stage, string> {3}= (\{[^\n]*\});/)
    expect(fg).not.toBeNull()
    expect(src).toContain(`const STAGE_C: Record<string, string> = ${fg![1]};`)
    expect(src).not.toMatch(/color: stageColor\b/)
    expect(src).toContain("background: stageColor")
  })
})

// ── Data-encoding hues stay readable in both themes ─────────────────────────

function luminance(hex: string): number {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
// --bg-surface / --bg-raised per theme (app/globals.css).
const SURFACES = { dark: ['#111113', '#151517', '#0B0B0C'], light: ['#FFFFFF', '#F5F3EE'] }

function hueBlocks(css: string): { dark: Record<string, string>; light: Record<string, string> } {
  const clean = stripComments(css)
  const lightStart = clean.indexOf(":global(:root[data-theme='light'])")
  expect(lightStart).toBeGreaterThan(0)
  const grab = (s: string) =>
    Object.fromEntries([...s.matchAll(/--((?:stage|dep|agent)-[a-z-]+):\s*(#[0-9a-f]{6});/g)].map(m => [m[1], m[2]]))
  const lightEnd = clean.indexOf('}', lightStart)
  return { dark: grab(clean.slice(0, lightStart)), light: grab(clean.slice(lightStart, lightEnd)) }
}

describe('Remaining visual islands (A) — encoding hues are theme-aware and >= 3:1', () => {
  const MODULES: [string, number][] = [
    ['app/admin/web-services/WebServices.module.css', 10],
    ['app/admin/deployments/Deployments.module.css', 14],
    ['app/admin/agent-runs/AgentRuns.module.css', 5],
  ]
  for (const [file, count] of MODULES) {
    it(`${file}: every hue is defined for both themes and meets 3:1 on its theme's surfaces`, () => {
      const { dark, light } = hueBlocks(read(file))
      expect(Object.keys(dark)).toHaveLength(count)
      expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort())
      for (const [theme, map] of [['dark', dark], ['light', light]] as const) {
        for (const [name, hex] of Object.entries(map)) {
          for (const bg of SURFACES[theme]) {
            expect(contrast(hex, bg), `${file} ${theme} --${name} ${hex} on ${bg}`).toBeGreaterThanOrEqual(3)
          }
        }
      }
    })
  }

  it('hues are never used as text colour — text sits on text / status tokens', () => {
    for (const file of CSS) {
      const c = stripComments(read(file))
      expect(c, file).not.toMatch(/(^|[^-])color:\s*var\(--(stage|dep|agent|hue)/m)
    }
    for (const file of TSX) {
      const c = stripComments(read(file))
      expect(c, file).not.toMatch(/\bcolor:\s*(col|c|stage|typeM|maint|status)\.color\b/)
    }
  })
})

// ── Preserved behaviour ─────────────────────────────────────────────────────

describe('LockScreen — unlock behaviour preserved, dialog + toggle semantics added', () => {
  const src = stripComments(read('components/session/LockScreen.tsx'))
  it('same verify-lock request, attempt counting, messages, autofocus delay and callbacks', () => {
    expect(src).toMatch(/fetch\('\/api\/auth\/verify-lock', \{\s*method: 'POST',\s*headers: \{ 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(\{ password \}\),\s*\}\)/)
    expect(src).toContain('setAttempts(a => a + 1);')
    expect(src).toContain("setError(data.error || 'Incorrect password.');")
    expect(src).toContain("setError('Connection error. Please try again.');")
    expect(src).toContain('setTimeout(() => inputRef.current?.focus(), 350)')
    expect(src).toContain('onUnlock();')
    expect(src).toContain('attempts >= 3')
    expect(src).toContain('href="/login"')
    expect(src).toContain('autoComplete="current-password"')
    expect(src).toContain("{loading ? 'Verifying…' : 'Unlock Session'}")
  })
  it('is a modal dialog with a real, focusable, pressed-state password toggle', () => {
    expect(src).toContain('role="dialog"')
    expect(src).toContain('aria-modal="true"')
    expect(src).toContain('aria-labelledby={titleId}')
    expect(src).toContain('aria-pressed={showPw}')
    expect(src).toContain('aria-label="Show password"')
    expect(src).not.toMatch(/tabIndex=\{-1\}\s*\n?\s*(style|className)=\{?styles\.toggle/)
    const toggle = src.slice(src.indexOf('onClick={() => setShowPw'), src.indexOf('aria-controls'))
    expect(toggle).not.toContain('tabIndex')
  })
  it('the lock backdrop is opaque (nothing behind a locked session is readable)', () => {
    const css = stripComments(read('components/session/LockScreen.module.css'))
    const overlay = css.slice(css.indexOf('.overlay {'), css.indexOf('}', css.indexOf('.overlay {')))
    expect(overlay).toMatch(/background:\s*var\(--bg-base\)/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/)
  })
  it('SessionProvider still mounts it exactly as before', () => {
    expect(read('components/session/SessionProvider.tsx')).toContain('{hasSession && locked && <LockScreen name={name} onUnlock={unlock} />}')
  })
})

describe('Web Systems pipeline — data, mutations and drag/drop preserved', () => {
  const src = stripComments(read('app/admin/web-services/page.tsx'))
  it('same fetch / PATCH / DELETE calls', () => {
    expect(src).toContain('await fetch(`/api/web-services/leads?${params}`)')
    expect(src).toMatch(/fetch\(`\/api\/web-services\/leads\/\$\{id\}`, \{\s*method:\s*'PATCH'/)
    expect(src).toContain("fetch(`/api/web-services/leads/${id}`, { method: 'DELETE' })")
  })
  it('drag and drop wiring and the local horizontal kanban scroll are intact', () => {
    expect(src).toContain('draggable')
    expect(src).toContain('onDragStart={e => onDragStart(e, lead.id)}')
    expect(src).toContain('onDragOver={e => onDragOver(e, col.status)}')
    expect(src).toContain('onDrop={e => onDrop(e, col.status)}')
    expect(src).toContain('if (lead && lead.status !== status) patchLead(dragId, { status });')
    expect(src).toContain("style={{ overflowX: 'auto', overflowY: 'hidden' }}")
  })
  it('cards are keyboard-operable buttons; the drawer is the shared SlidePanel', () => {
    expect(src).toContain('role="button"')
    expect(src).toContain('tabIndex={0}')
    expect(src).toMatch(/e\.key === 'Enter' \|\| e\.key === ' '/)
    expect(src).toContain('<SlidePanel open={drawerOpen} onClose={closeDrawer}')
    expect(src).toContain('aria-pressed={view === v}')
    expect(src).toContain('aria-pressed={filterGroup === g}')
  })
  it('LeadMessages keeps its GET / POST calls', () => {
    const lm = stripComments(read('app/admin/web-services/LeadMessages.tsx'))
    expect(lm).toContain('fetch(`/api/web-services/leads/${leadId}/messages`)')
    expect(lm).toMatch(/fetch\(`\/api\/web-services\/leads\/\$\{leadId\}\/messages`, \{\s*method: 'POST'/)
    expect(lm).toContain('JSON.stringify({ subject: subject.trim(), body: body.trim() })')
  })
})

describe('Deployment operations — data, mutations and calculations preserved', () => {
  const src = stripComments(read('app/admin/deployments/page.tsx'))
  it('same fetches and mutations', () => {
    for (const u of ["fetch('/api/web-services/proposals?limit=100')", "fetch('/api/deployments/onboarding')", "fetch('/api/deployments/managed-services?status=ALL')"]) {
      expect(src).toContain(u)
    }
    expect(src).toMatch(/fetch\('\/api\/web-services\/proposals', \{\s*method:\s*'POST'/)
    expect(src).toContain("method: 'PATCH', headers: { 'Content-Type': 'application/json' },")
  })
  it('same metric / progress calculations', () => {
    expect(src).toContain("const pendingCount = proposals.filter(p => ['sent', 'viewed'].includes(p.status)).length;")
    expect(src).toContain('const progress    = Math.round(((stageIdx + 1) / ONBOARDING_STAGES.length) * 100);')
    expect(src).toContain('${(metrics.mrr * 12).toFixed(0)}')
  })
  it('tabs follow the tabs pattern; the sticky strip keeps the shared header offset', () => {
    expect(src).toContain('role="tablist"')
    expect(src).toContain('role="tab"')
    expect(src).toContain('aria-selected={tab === t.key}')
    expect(src).toContain('role="tabpanel"')
    expect(src).toContain("position: 'sticky', top: APP_HEADER_OFFSET_VAR, zIndex: 50,")
  })
})

describe('Agent runs / Administration — residue fixed, behaviour preserved', () => {
  it('agent runs keeps its request and identity maps; filters are labelled', () => {
    const src = stripComments(read('app/admin/agent-runs/AgentRunsDashboard.tsx'))
    expect(src).toContain('await fetch(`/api/admin/agent-runs?${p}`)')
    for (const k of ['InsightAgent:', 'ActionAgent:', 'BriefingAgent:', 'DataIntakeAgent:', 'HLNAChatAgent:']) expect(src).toContain(k)
    for (const l of ['aria-label="Organisation"', 'aria-label="Agent"', 'aria-label="Route type"', 'htmlFor={fromId}', 'htmlFor={toId}']) expect(src).toContain(l)
    expect(src).toContain('<MetricStrip>')
  })
  it('AdminClient dismiss buttons are named and its controls use the shared field control', () => {
    const src = stripComments(read('app/admin/orgs/AdminClient.tsx'))
    expect((src.match(/aria-label="Dismiss message"/g) ?? []).length).toBe(2)
    expect(src).toContain('const inp = fieldControlClassName;')
    expect(src).not.toContain('style={inp}')
  })
})
