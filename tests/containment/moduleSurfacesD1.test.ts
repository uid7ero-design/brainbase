import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D1 regression guard — module navigation, Events, Admin, Ops.
//
// Scoped to the files converted in D1. It blocks the failure classes this
// phase removed — dark-only white-alpha neutrals, forced-dark Events
// surfaces, the retired violet palette, glass blur, gradient / glow
// treatments, outline suppression and module-specific active-state drift —
// while leaving legitimate operational colour ENCODINGS alone (status,
// severity, priority and agent maps are data; see the D1 audit note).

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
function cssRule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} rule not found`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

// Pure white or near-white (every channel 220–255): dark-only neutral text.
const WHITE_ALPHA = /rgba?\(\s*2[2-5]\d\s*,\s*2[2-5]\d\s*,\s*2[2-5]\d\s*,/
const OLD_VIOLET = /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|DDD6FE)\b|rgba?\(\s*(124\s*,\s*58\s*,\s*237|139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250)\b|var\(--purple-\d/i
const GLASS = /backdrop-?filter|\bblur\(/i
const GRADIENT = /(linear|radial|conic)-gradient/
const OUTLINE_SUPPRESSION = /outline\s*:\s*['"]?\s*(none|0)\b/
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/
const DARK_SURFACE = /#(07080B|08090C|0e1014|0d0f14|0f1117|111215|111318|0f1018|0B0C12|1a1d24|1f2937|1f2433)\b|rgba\(\s*(7\s*,\s*5\s*,\s*16|9\s*,\s*10\s*,\s*14|7\s*,\s*8\s*,\s*11|4\s*,\s*5\s*,\s*9|6\s*,\s*7\s*,\s*11)\s*,/i

/** Removes whole lines that are entries of documented colour-encoding maps. */
function withoutEncodingMaps(code: string, markers: string[]): string {
  return code
    .split('\n')
    .filter(line => !markers.some(m => line.includes(m)) && !/\b(label|key)\s*:/.test(line))
    .join('\n')
}

// ── A. Shared module navigation ────────────────────────────────────────
describe('Module navigation — one active-state language', () => {
  const NAV_CSS = ['components/ui/app/ModuleNav.module.css', 'components/ops/OpsSidebar.module.css']

  for (const file of NAV_CSS) {
    const css = stripComments(read(file))
    it(`${file}: tokens only, flat, focus-visible`, () => {
      expect(css).not.toMatch(COLOUR_LITERAL)
      expect(css).not.toMatch(GRADIENT)
      expect(css).not.toMatch(GLASS)
      expect(css).not.toMatch(OUTLINE_SUPPRESSION)
    })

    it(`${file}: active = accent text + inset 2px rule + accent tint, keyed on aria-current`, () => {
      const rule = cssRule(css, ".item[aria-current='page']")
      expect(rule).toContain('color: var(--brand-brainbase-accent);')
      expect(rule).toContain('background: var(--brand-brainbase-accent-muted);')
      expect(rule).toContain('box-shadow: inset 2px 0 0 var(--brand-brainbase-accent);')
    })
  }

  it('CRM, Commercial and Admin render the shared ModuleSidebar (no private inline active styling)', () => {
    for (const file of ['app/crm/_components/CrmSidebar.tsx', 'app/commercial/_components/CommercialSidebar.tsx', 'components/admin/AdminAside.tsx']) {
      const code = stripComments(read(file))
      expect(code, file).toContain('<ModuleSidebar')
      expect(code, file).not.toMatch(/color-mix\(/)
      expect(code, file).not.toMatch(WHITE_ALPHA)
      expect(code, file).not.toMatch(COLOUR_LITERAL)
    }
    expect(stripComments(read('components/admin/AdminAside.tsx'))).toContain('moduleNavItemProps(')
  })

  it('the Ops sidebar uses aria-current and class-based hover (no JS colour swapping) and the approved mark', () => {
    const code = stripComments(read('components/ops/Sidebar.tsx'))
    expect(code).toContain("aria-current={active ? 'page' : undefined}")
    expect(code).toContain('className={styles.item}')
    expect(code).not.toMatch(/onMouseEnter/)
    // The brand link uses the approved broken-orbit mark; the bolt glyph
    // that remains is the Command Centre nav ICON, not a logo.
    const brandLinks = code.match(/<Link href="\/dashboard"[\s\S]*?<\/Link>/g) ?? []
    expect(brandLinks.length).toBe(2)
    for (const link of brandLinks) {
      expect(link).toContain('<BrokenOrbitMark')
      expect(link).not.toMatch(/<polygon/)
    }
    expect(code).not.toMatch(COLOUR_LITERAL)
  })
})

// ── B. Events ──────────────────────────────────────────────────────────
describe('Events — no forced-dark or dark-only surfaces', () => {
  const EVENTS_FILES = [
    'app/events/_components/ui.tsx',
    'app/events/EventsListClient.tsx',
    'app/events/[id]/EventDetailClient.tsx',
    'app/events/[id]/RegistrationsPanel.tsx',
    'app/events/[id]/RegistrationDetail.tsx',
    'app/events/[id]/QuestionsPanel.tsx',
    'app/events/[id]/check-in/CheckInClient.tsx',
    'app/events/payments/PaymentsClient.tsx',
    'app/events/page.tsx',
    'app/events/[id]/page.tsx',
    'app/events/[id]/check-in/page.tsx',
    'app/events/payments/page.tsx',
  ]

  for (const file of EVENTS_FILES) {
    it(`${file}: no white-alpha, retired violet, glass, gradient or outline suppression`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(WHITE_ALPHA)
      expect(code).not.toMatch(OLD_VIOLET)
      expect(code).not.toMatch(GLASS)
      expect(code).not.toMatch(GRADIENT)
      expect(code).not.toMatch(OUTLINE_SUPPRESSION)
      expect(code).not.toMatch(/#FCA5A5|#e5e7eb/i)
    })
  }

  it('the Events kit is token-only (status, buttons, dropdown panel, scoped CSS)', () => {
    expect(stripComments(read('app/events/_components/ui.tsx'))).not.toMatch(COLOUR_LITERAL)
  })

  it('Events status badges render the canonical semantic Badge', () => {
    const ui = stripComments(read('app/events/_components/ui.tsx'))
    expect(ui).toContain("import { Badge, type SemanticState } from '@/components/ui/app';")
    expect(ui).toContain('<Badge state={TONE_STATE[tone]}>{label}</Badge>')
  })

  it('no forced-dark KPI cards: metrics use the shared MetricStrip', () => {
    for (const file of ['app/events/EventsListClient.tsx', 'app/events/[id]/EventDetailClient.tsx']) {
      const code = stripComments(read(file))
      expect(code, file).not.toMatch(/KpiCard/)
      expect(code, file).not.toMatch(/theme="dark"/)
      expect(code, file).toContain('<MetricStrip')
    }
  })
})

// ── C. Admin ───────────────────────────────────────────────────────────
describe('Admin — light mode genuinely supported on converted surfaces', () => {
  const ADMIN_FILES = [
    'app/admin/layout.tsx',
    'components/admin/AdminAside.tsx',
    'app/admin/users/UsersClient.tsx',
    'app/admin/orgs/AdminClient.tsx',
    'app/admin/implementations/page.tsx',
    'app/admin/implementations/[id]/page.tsx',
    'app/admin/client-events/ClientEventsClient.tsx',
    'app/admin/pipeline/page.tsx',
    'app/admin/sessions/page.tsx',
    'app/admin/agent-runs/AgentRunsDashboard.tsx',
    'app/admin/agent-test/page.tsx',
  ]

  for (const file of ADMIN_FILES) {
    it(`${file}: no dark-only surfaces, white-alpha neutrals, retired violet, glass or outline suppression`, () => {
      // Documented encoding maps (founder CRM stages, agent/route colours)
      // are data and excluded by line.
      const code = withoutEncodingMaps(stripComments(read(file)), ['STAGE_C', 'AGENT_COLOR', 'ROUTE_COLOR', 'Agent:', 'insight:', 'action:', 'briefing:', 'dataIntake:', 'chat:'])
      expect(code).not.toMatch(DARK_SURFACE)
      expect(code).not.toMatch(WHITE_ALPHA)
      expect(code).not.toMatch(OLD_VIOLET)
      expect(code).not.toMatch(GLASS)
      expect(code).not.toMatch(OUTLINE_SUPPRESSION)
    })
  }

  it('the admin shell is on the page-base token, not a hard-coded dark background', () => {
    const layout = stripComments(read('app/admin/layout.tsx'))
    expect(layout).toContain("background: 'var(--bg-base)'")
    expect(layout).toContain("color: 'var(--text-primary)'")
  })

  it('destructive admin actions use the semantic danger button', () => {
    expect(read('app/admin/users/UsersClient.tsx')).toContain('<Button size="sm" variant="danger" onClick={() => handleDelete(u)}>Delete</Button>')
    expect(read('app/admin/orgs/AdminClient.tsx')).toContain("<button type=\"button\" onClick={() => deleteOrg(o)} {...buttonProps('danger', 'sm')}>Delete</button>")
  })

  it('admin tables follow the shared table rhythm; modals use the shared Dialog', () => {
    for (const file of ['app/admin/users/UsersClient.tsx', 'app/admin/orgs/AdminClient.tsx']) {
      const code = read(file)
      expect(code, file).toContain('className={tableStyles.table}')
      expect(code, file).toContain('<TableContainer')
      expect(code, file).toMatch(/<Dialog\b/)
    }
  })
})

// ── D. Ops ─────────────────────────────────────────────────────────────
describe('Ops — shell and drawers converged, operational encodings kept', () => {
  const SHELL = ['components/ops/Sidebar.tsx', 'components/ops/OpBar.tsx', 'components/ops/WorkspaceShell.tsx']
  for (const file of SHELL) {
    it(`${file}: no white-alpha, retired violet, glass, gradient, glow or outline suppression`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(WHITE_ALPHA)
      expect(code).not.toMatch(OLD_VIOLET)
      expect(code).not.toMatch(GLASS)
      expect(code).not.toMatch(GRADIENT)
      expect(code).not.toMatch(/boxShadow:\s*['`]0 0 \d/)
      expect(code).not.toMatch(OUTLINE_SUPPRESSION)
    })
  }

  it('the workspace no longer injects document-wide box-sizing or scrollbar rules', () => {
    const code = stripComments(read('components/ops/WorkspaceShell.tsx'))
    expect(code).not.toMatch(/^\s*\*\s*\{\s*box-sizing/m)
    expect(code).toContain('.ws-shell ::-webkit-scrollbar')
  })

  const DRAWERS = ['components/ops/maintenance/MaintenanceJobDrawer.tsx', 'components/ops/maintenance/CreateJobModal.tsx', 'components/ops/DrilldownDrawer.tsx']
  for (const file of DRAWERS) {
    it(`${file}: themed surface, no glass/glow, dialog semantics`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(WHITE_ALPHA)
      expect(code).not.toMatch(GLASS)
      expect(code).not.toMatch(GRADIENT)
      expect(code).not.toMatch(/boxShadow:\s*`0 0 /)
      expect(code).not.toMatch(OUTLINE_SUPPRESSION)
      expect(code).not.toMatch(/colorScheme:\s*'dark'/)
      expect(code).toContain('role="dialog"')
      expect(code).toContain('aria-modal="true"')
      expect(code).toContain('useDialogFocus(true, onClose, panelRef)')
    })
  }

  it('meaningful operational encodings are preserved (severity / maintenance status)', () => {
    const drawer = read('components/ops/maintenance/MaintenanceJobDrawer.tsx')
    expect(drawer).toMatch(/SCHEDULED:\s*\{ color: '#A78BFA'/)
    expect(drawer).toMatch(/ESCALATED:\s*\{ color: '#F97316'/)
    expect(drawer).toMatch(/IN_PROGRESS: \{ color: '#F59E0B'/)
  })
})

// ── E. Status badge decision ───────────────────────────────────────────
describe('Status badge — compact tag in the app, pill kept on the public site', () => {
  const css = read('components/ui/semantic/semantic.module.css')

  it('app default: 4px radius tag in the surrounding face', () => {
    const rule = cssRule(css, '.badge')
    expect(rule).toContain('border-radius: var(--radius-sm, 4px);')
    expect(rule).not.toContain('font-family: var(--bb-font-mono);')
  })

  it('public site keeps the rounded mono pill', () => {
    const rule = cssRule(css, ':global(.bb-public) .badge')
    expect(rule).toContain('border-radius: 999px;')
    expect(rule).toContain('font-family: var(--bb-font-mono);')
  })
})
