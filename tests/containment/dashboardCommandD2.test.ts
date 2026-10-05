import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { CHART_PALETTE } from '@/components/ui/app/chartPalette'

// Phase D2 regression guard — generic Dashboard, Command Centre and the
// intelligence surfaces they share (widgets, IntelRail, KPI metrics,
// chart palette).
//
// Scoped to the files converted in D2. It blocks the failure classes this
// phase removed — glass blur, decorative gradients/glow, dark-only neutral
// text, the retired violet palette, outline suppression, purple used for
// alert states, assistant-state visuals dressed up as brand, and chart
// colours that cannot follow the theme — while leaving the pinned demo
// data, behaviour and assistant components alone (see the D2 audit note).

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

const WHITE_ALPHA = /rgba?\(\s*2[2-5]\d\s*,\s*2[2-5]\d\s*,\s*2[2-5]\d\s*,/
const OLD_VIOLET = /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|DDD6FE|a5b4fc)\b|rgba?\(\s*(124\s*,\s*58\s*,\s*237|139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|155\s*,\s*123\s*,\s*255|99\s*,\s*102\s*,\s*241)\b|var\(--purple-\d/i
const GLASS = /backdrop-?[fF]ilter|\bblur\(|feGaussianBlur/
const GRADIENT = /(linear|radial|conic)-?[gG]radient/
const GLOW = /drop-shadow|text-?[sS]hadow|(box-shadow|boxShadow)\s*:\s*[`'"]?\s*0 0 \d+px/
const OUTLINE_SUPPRESSION = /outline\s*:\s*['"]?\s*(none|0)\b/
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/
const FORCED_DARK = /#(07080B|08090C|04050A|0A0D12|F5F7FA)\b|colorScheme:\s*'dark'|theme="dark"/i

const D2_TSX = [
  'components/dashboard/OrganisationDashboard.tsx',
  'components/dashboard/ModuleAccessCard.tsx',
  'components/TrialBanner.tsx',
  'app/dashboard/loading.tsx',
  'app/command/page.tsx',
  'app/command/financial.tsx',
  'components/ops/IntelRail.tsx',
  'components/ops/widgets/HlnaBriefingWidget.tsx',
  'components/ops/widgets/WeatherWidget.tsx',
  'components/ops/widgets/MapWidget.tsx',
]
const D2_CSS = [
  'components/dashboard/OrganisationDashboard.module.css',
  'components/dashboard/ModuleAccessCard.module.css',
  'app/dashboard/loading.module.css',
  'app/command/command.module.css',
  'components/ops/IntelRail.module.css',
  'components/ops/widgets/widgets.module.css',
  'components/ui/app/Metric.module.css',
]

// ── Surfaces: flat, theme-token only ────────────────────────────────────
describe('D2 surfaces — no glass, glow, gradients, forced dark or retired violet', () => {
  for (const file of [...D2_TSX, ...D2_CSS]) {
    const code = stripComments(read(file))
    it(`${file}`, () => {
      expect(code).not.toMatch(GLASS)
      expect(code).not.toMatch(GRADIENT)
      expect(code).not.toMatch(GLOW)
      expect(code).not.toMatch(WHITE_ALPHA)
      expect(code).not.toMatch(OLD_VIOLET)
      expect(code).not.toMatch(FORCED_DARK)
      expect(code).not.toMatch(OUTLINE_SUPPRESSION)
    })
  }

  it('D2 components carry no raw colour literals — colour comes from tokens (CSS) or the chart palette (SVG)', () => {
    for (const file of [...D2_TSX, ...D2_CSS]) {
      expect(stripComments(read(file)), file).not.toMatch(COLOUR_LITERAL)
    }
  })

  it('every interactive surface D2 styles has a :focus-visible rule', () => {
    const cmd = read('app/command/command.module.css')
    for (const sel of ['.tab:focus-visible', '.ribbonCell:focus-visible', '.alertOpen:focus-visible', '.actionRow:focus-visible', '.suggestion:focus-visible', '.editButton:focus-visible', '.editInput:focus-visible']) {
      expect(cmd, sel).toContain(sel)
    }
    expect(read('components/ops/IntelRail.module.css')).toContain('.taskLink:focus-visible')
    expect(read('components/ops/widgets/widgets.module.css')).toContain('.recoLink:focus-visible')
    expect(read('components/dashboard/ModuleAccessCard.module.css')).toContain('.row:focus-visible')
  })
})

// ── Organisation dashboard hierarchy ────────────────────────────────────
describe('Organisation dashboard — shared system and reading order', () => {
  const code = stripComments(read('components/dashboard/OrganisationDashboard.tsx'))

  it('uses PageHeader, MetricStrip/Metric, Panel + StateMessage — no private metric card or card-in-card', () => {
    expect(code).toContain('<PageHeader')
    expect(code).toContain('<MetricStrip>')
    expect(code).toContain('<StateMessage kind="empty" title="No operational metrics available yet">')
    expect(code).not.toMatch(/function (MetricCard|Card)\b/)
  })

  it('reads org context → exceptions → key metrics → module access', () => {
    const header = code.indexOf('<PageHeader')
    const exceptions = code.indexOf('aria-label="Needs attention"')
    const metrics = code.indexOf('<MetricStrip>')
    const modules = code.indexOf('<ModuleAccessCard')
    expect(header).toBeGreaterThan(-1)
    expect(exceptions).toBeGreaterThan(header)
    expect(metrics).toBeGreaterThan(exceptions)
    expect(modules).toBeGreaterThan(metrics)
  })

  it('threshold tones reuse the one set of named thresholds (no drifting literals)', () => {
    expect(code).toContain('const contamHigh   = hasWasteData && avgContam > CONTAMINATION_THRESHOLD;')
    expect(code).toContain('const defectsHigh  = hasFleetData && totalDefects > DEFECT_THRESHOLD;')
    expect(code).toContain('const requestsHigh = hasSRData && openCount > OPEN_REQUEST_THRESHOLD;')
    expect(code).toContain("tone={contamHigh ? 'danger' : undefined}")
  })

  it('module access is a compact list: one row per module, no hover-state JS or tiles', () => {
    const card = stripComments(read('components/dashboard/ModuleAccessCard.tsx'))
    expect(card).toContain('<ul className={styles.list}>')
    expect(card).not.toMatch(/onMouseEnter|useState/)
    // Nav consolidation update (feat/authenticated-nav-consolidation): rows
    // now come from navModel.workModuleCards; the icon key is the
    // descriptor's `icon` (entry.icon), not a local MODULE_ENTRIES key.
    expect(card).toContain('<CapabilityIcon capability={entry.icon} size="sm" />')
  })
})

// ── Semantic status separation ──────────────────────────────────────────
describe('Alerts and statuses — semantic colours, never purple, never colour alone', () => {
  it('status tone classes map to status tokens; the accent is not a status colour', () => {
    for (const file of ['app/command/command.module.css', 'components/ops/widgets/widgets.module.css', 'components/ops/IntelRail.module.css']) {
      const css = read(file)
      expect(css, file).toContain(".tone[data-status='danger'] { --status-colour: var(--status-danger); }")
      expect(css, file).toContain(".tone[data-status='warning'] { --status-colour: var(--status-warning); }")
      expect(css, file).not.toMatch(/data-status='(danger|warning)'\][^}]*brand-brainbase-accent/)
    }
  })

  it('Command alert status map: critical → danger/error, warning → warning, stable → success, each with a written label', () => {
    const code = read('app/command/page.tsx')
    expect(code).toContain('critical: { tone: "danger",  badge: "error",   label: "Critical" },')
    expect(code).toContain('warning:  { tone: "warning", badge: "warning", label: "Warning"  },')
    expect(code).toContain('stable:   { tone: "success", badge: "success", label: "Stable"   },')
    // The alert card shows the status as a Badge (text), not only as colour.
    expect(code).toContain('<Badge state={s.badge}>{s.label}</Badge>')
  })

  it('IntelRail: priority → danger/warning/info; the accent is reserved for HLNA/AI product state', () => {
    const code = read('components/ops/IntelRail.tsx')
    expect(code).toMatch(/critical: 'danger',\s*high:\s*'warning',\s*medium:\s*'info'/)
    expect(code).toMatch(/alert:\s*'danger'/)
    expect(code).toMatch(/ai:\s*'accent'/)
    expect(code).toContain('<span className={styles.srOnly}>{task.priority} priority: </span>')
  })

  it('KPI trends: good/bad is independent of direction and the direction is written as a glyph', () => {
    const page = read('app/command/page.tsx')
    expect(page).toContain('change={{ label: kpi.trendLabel, direction: kpi.trend, tone: kpi.trendBad ? "danger" : "success" }}')
    const metric = read('components/ui/app/Metric.tsx')
    expect(metric).toContain("const CHANGE_GLYPH = { up: '▲', down: '▼', flat: '–' } as const;")
  })
})

// ── Assistant visuals vs brand ──────────────────────────────────────────
describe('HLNA — assistant state kept, not dressed up as brand; approved mark for identity', () => {
  it('HlnaOrb (functional state) renders directly with its state prop — no glow/drop-shadow wrapper', () => {
    for (const file of ['app/command/page.tsx', 'components/ops/IntelRail.tsx']) {
      const code = read(file)
      const idx = code.indexOf('<HlnaOrb')
      expect(idx, file).toBeGreaterThan(-1)
      expect(code.slice(idx, code.indexOf('/>', idx)), file).toMatch(/state=\{/)
      expect(code.slice(Math.max(0, idx - 200), idx), file).not.toMatch(/filter|animation|drop-shadow/)
    }
  })

  it('the briefing identity uses the approved broken-orbit mark, not the legacy wordmark image', () => {
    const code = read('components/ops/widgets/HlnaBriefingWidget.tsx')
    expect(code).toContain('<BrokenOrbitMark size={16} context="hlna" />')
    expect(stripComments(code)).not.toContain('hlna-wordmark.svg')
  })

  it('no legacy "HLNΛ" lambda treatment remains in D2 surfaces', () => {
    for (const file of D2_TSX) {
      const code = stripComments(read(file))
      expect(code, file).not.toMatch(/HLN<span/)
      expect(code, file).not.toContain('HLNΛ')
    }
  })

  it('the protected assistant components are untouched in shape (still exported, still stateful)', () => {
    expect(read('components/brand/HlnaOrb.jsx')).toContain('/hlna-orb-only.webp')
  })
})

// ── Chart palette ───────────────────────────────────────────────────────
function luminance(hex: string): number {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

describe('Chart palette — JS-resolvable, mirrors the theme tokens, readable in both themes', () => {
  const css = read('app/globals.css') + '\n' + read('styles/brainbase-tokens.css')
  const MIRRORS: Record<'dark' | 'light', [keyof typeof CHART_PALETTE.dark, string][]> = {
    dark: [['primary', '--brand-brainbase-accent'], ['secondary', '--purple-200'], ['comparison', '--text-muted'], ['success', '--bb-success-dot'], ['warning', '--bb-warning-dot'], ['danger', '--bb-error-dot'], ['info', '--bb-cyan-400'], ['neutral', '--text-subtle'], ['axis', '--text-muted'], ['tooltipBg', '--bg-overlay'], ['tooltipText', '--text-primary']],
    light: [['primary', '--brand-brainbase-accent'], ['comparison', '--text-subtle'], ['success', '--bb-success-dot'], ['warning', '--bb-warning-fg'], ['danger', '--bb-error-dot'], ['info', '--bb-cyan-600'], ['neutral', '--text-subtle'], ['axis', '--text-muted'], ['tooltipBg', '--bg-overlay'], ['tooltipText', '--text-primary']],
  }

  for (const theme of ['dark', 'light'] as const) {
    it(`${theme}: every mirrored value exists as that token's value in the CSS`, () => {
      for (const [key, token] of MIRRORS[theme]) {
        const value = CHART_PALETTE[theme][key]
        expect(css, `${theme}.${key} → ${token}`).toMatch(new RegExp(`${token}:\\s*${value.replace(/[()]/g, '\\$&')}\\b`, 'i'))
      }
    })

    it(`${theme}: every series colour is ≥3:1 on the panel surface`, () => {
      const surface = theme === 'dark' ? '#111113' : '#FFFFFF'
      for (const key of ['primary', 'secondary', 'comparison', 'success', 'warning', 'danger', 'info', 'neutral'] as const) {
        expect(contrast(CHART_PALETTE[theme][key], surface), `${theme}.${key}`).toBeGreaterThanOrEqual(3)
      }
    })
  }

  it('the two themes are not an inversion of one palette: grid, axis and tooltip differ per theme', () => {
    for (const key of ['grid', 'axis', 'tooltipBg', 'tooltipText', 'primary'] as const) {
      expect(CHART_PALETTE.dark[key], key).not.toBe(CHART_PALETTE.light[key])
    }
  })

  it('D2 SVG graphics read the palette (hook), not hard-coded colours', () => {
    expect(read('app/command/page.tsx')).toContain('color={kpi.trendBad ? chart.danger : chart.success}')
    for (const file of ['components/ops/widgets/MapWidget.tsx', 'components/ops/IntelRail.tsx']) {
      expect(read(file), file).toContain('useChartPalette()')
    }
  })
})

// ── Command structure ───────────────────────────────────────────────────
describe('Command — accessible controls without behaviour change', () => {
  const page = read('app/command/page.tsx')

  it('tabs are a real tablist with roving focus; the ribbon cells are buttons with aria-expanded', () => {
    expect(page).toContain('role="tablist" aria-label="Command Centre views"')
    expect(page).toContain('role="tab"')
    expect(page).toContain('aria-selected={selected}')
    expect(page).toContain('tabIndex={selected ? 0 : -1}')
    expect(page).toContain('aria-expanded={isOpen}')
    expect(page).not.toMatch(/<div key=\{sys\.label\}\s*onClick/)
  })

  it('the assistant input is labelled and the send button is named', () => {
    expect(page).toContain('<label htmlFor="cc-assistant-input" className={styles.srOnly}>Message HLNA</label>')
    expect(page).toContain('aria-label="Send message"')
    expect(page).toContain('role="log" aria-live="polite"')
  })

  it('financial edit cells are buttons (keyboard reachable), not clickable <td>s', () => {
    const fin = read('app/command/financial.tsx')
    expect(fin).not.toMatch(/<td[^>]*onClick/)
    expect(fin).toContain('className={styles.editButton} onClick={startEdit}')
    expect(fin).toContain('aria-label={label}')
  })
})
