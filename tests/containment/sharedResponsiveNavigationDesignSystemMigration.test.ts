import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const topNav = fs.readFileSync(
  path.resolve(__dirname, '../../components/nav/TopNav.tsx'),
  'utf-8',
).replace(/\r\n/g, '\n')

const publicNav = fs.readFileSync(
  path.resolve(__dirname, '../../components/public/PublicNav.tsx'),
  'utf-8',
).replace(/\r\n/g, '\n')

const routes = fs.readFileSync(
  path.resolve(__dirname, '../../components/public/routes.ts'),
  'utf-8',
).replace(/\r\n/g, '\n')

const sidebar = fs.readFileSync(
  path.resolve(__dirname, '../../components/ops/Sidebar.tsx'),
  'utf-8',
).replace(/\r\n/g, '\n')

const shell = fs.readFileSync(
  path.resolve(__dirname, '../../components/ops/WorkspaceShell.tsx'),
  'utf-8',
).replace(/\r\n/g, '\n')

const chromeCss = fs.readFileSync(path.resolve(__dirname, '../../components/nav/AppChrome.module.css'), 'utf-8')

// Global overflow-masking detector. Scans every innermost CSS rule (so rules
// nested in @media/@supports are included) and reports any whose selector list
// targets the document roots — html, body or :root, alone or with attribute /
// pseudo-class qualifiers such as :root[data-theme='light'], but NOT descendants
// like `body .x` — and whose declarations clip horizontal overflow:
// overflow-x: hidden|clip, or an overflow shorthand whose first (x) value is
// hidden|clip. Component-level rules (.scroller { overflow-x: auto }, table
// wrappers, nav scroll rows) and root-level `auto` are deliberately allowed.
function globalOverflowMasking(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const offenders: string[] = []
  const rule = /([^{}]+)\{([^{}]*)\}/g
  for (const m of clean.matchAll(rule)) {
    const selectors = m[1].split(',').map(x => x.trim().replace(/\s+/g, ' ')).filter(Boolean)
    const targetsRoot = selectors.some(sel =>
      /^(html|body|:root)(?=$|[:[.#])/i.test(sel) && !/[\s>+~]/.test(sel))
    if (!targetsRoot) continue
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':')
      if (i < 0) continue
      const prop = decl.slice(0, i).trim().toLowerCase()
      const value = decl.slice(i + 1).replace(/!important/i, '').trim().toLowerCase()
      const x = prop === 'overflow-x' ? value : prop === 'overflow' ? value.split(/\s+/)[0] : ''
      if (x === 'hidden' || x === 'clip') offenders.push(`${m[1].trim()} { ${decl.trim()} }`)
    }
  }
  return offenders
}

describe('B.4 shared responsive navigation design-system migration', () => {
  it('contains page-level horizontal overflow so authenticated chrome cannot drift off the left viewport edge', () => {
    // Integration note (main + app visual convergence): main's B.x rollout pinned its own
    // inline chrome styling. The reviewed Phase B (TopNav / AppChrome.module.css) and Phase D1
    // (OpBar / Sidebar) implementations supersede that presentation, so this assertion now pins
    // the reviewed equivalent. Behavioural assertions in this file are unchanged.
    // Page-level overflow is contained by the layouts themselves (the centre nav row scrolls
    // internally; TopNav starts left-aligned). A global html/body overflow-x: hidden is
    // deliberately NOT used: it would mask real overflow regressions (Phase E measured 0
    // page overflow across 90 harness combinations without it).
    // Both stylesheets that apply document-wide (globals.css imports brainbase-tokens.css).
    for (const file of ['app/globals.css', 'styles/brainbase-tokens.css']) {
      const css = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf-8')
      expect(globalOverflowMasking(css), file).toEqual([])
    }
    expect(topNav).toContain("overflowX: 'auto'")

  })
  it('keeps the existing narrow-width TopNav strategy: natural-width items inside a horizontally scrollable centre row', () => {
    // Integration note (main + app visual convergence): main's B.x rollout pinned its own
    // inline chrome styling. The reviewed Phase B (TopNav / AppChrome.module.css) and Phase D1
    // (OpBar / Sidebar) implementations supersede that presentation, so this assertion now pins
    // the reviewed equivalent. Behavioural assertions in this file are unchanged.
    expect(topNav).toContain("overflowX: 'auto'")
    expect(topNav).toContain("overflowY: 'hidden'")
    expect(chromeCss).toMatch(/scrollbar-width: thin/)
    expect(topNav).toContain('flex: 1')
    expect(topNav).toContain('minWidth: 0')

  })

  it('preserves the extracted public navigation destinations and mobile-menu behavior from current main', () => {
    expect(topNav).toContain("import { PublicNav } from '@/components/public/PublicNav'")
    expect(topNav).toContain('<PublicNav')
    for (const href of ['/#product', '/client-operations', '/web-systems', '/pricing', '/demo']) {
      expect(routes).toContain(`href: '${href}'`)
    }
    expect(publicNav).toContain('href="/login"')
    expect(publicNav).toContain('href="/request-demo"')
    expect(publicNav).toContain('const [openOn, setOpenOn] = useState<string | null>(null)')
    expect(publicNav).toContain("if (e.key === 'Escape')")
    expect(publicNav).toContain('aria-expanded={open}')
    expect(publicNav).toContain('hidden={!open}')
  })

  it('preserves capability-driven authenticated navigation exactly', () => {
    for (const text of [
      'const hasEvents =',
      "enabledCapabilities.includes(\n      'events'",
      'const hasCrm =',
      "enabledCapabilities.includes(\n      'crm'",
      'const hasOrganiser =',
      "enabledCapabilities.includes(\n      'organiser'",
      'const hasCommercial =',
      "'quotes',",
      "'invoicing',",
      "'purchasing',",
      'const hasPeople =',
      "'people',",
    ]) {
      expect(topNav).toContain(text)
    }

    for (const href of ['/events', '/crm', '/organiser', '/commercial', '/people']) {
      expect(topNav).toContain('href="' + href + '"')
    }
  })

  it('preserves role visibility and super-admin-specific navigation boundaries', () => {
    expect(topNav).toContain("const isSuperAdmin =\n    role === 'super_admin'")
    expect(topNav).toContain("const isManagerPlus =\n    ['manager', 'admin', 'super_admin'].includes(")
    expect(topNav).toContain('{isSuperAdmin && (')
    expect(topNav).toContain('<AdminDropdown')
    expect(topNav).toContain("(role === 'admin' || role === 'super_admin')")
    expect(topNav).toContain('href="/settings/branding"')
  })

  it('preserves profile, logout, and responsive system-cluster interactions', () => {
    // Integration note (main + app visual convergence): main's B.x rollout pinned its own
    // inline chrome styling. The reviewed Phase B (TopNav / AppChrome.module.css) and Phase D1
    // (OpBar / Sidebar) implementations supersede that presentation, so this assertion now pins
    // the reviewed equivalent. Behavioural assertions in this file are unchanged.
    expect(topNav).toContain('href="/account/profile"')
    expect(topNav).toContain("await import(\n                '@/app/actions/auth'")
    expect(topNav).toContain('await logout()')
    expect(topNav).toContain('flexShrink: 0')

  })

  it('preserves dropdown portal interaction so narrow navigation is not clipped by the scroll container', () => {
    // Integration note (main + app visual convergence): main's B.x rollout pinned its own
    // inline chrome styling. The reviewed Phase B (TopNav / AppChrome.module.css) and Phase D1
    // (OpBar / Sidebar) implementations supersede that presentation, so this assertion now pins
    // the reviewed equivalent. Behavioural assertions in this file are unchanged.
    expect(topNav.match(/createPortal\(/g)?.length).toBe(2)
    expect(topNav).toContain("overflowX: 'auto'")
    expect(topNav.match(/top: rect\.bottom \+ 6/g)?.length).toBe(2)

  })

  it('preserves the shared Ops shell collapse interaction and stored responsive state', () => {
    expect(sidebar).toContain('width: collapsed ? 56 : 220')
    expect(sidebar).toContain('minWidth: collapsed ? 56 : 220')
    expect(sidebar).toContain("flexDirection: collapsed ? 'column' : 'row'")
    expect(sidebar).toContain("transform: collapsed ? 'rotate(180deg)' : 'none'")
    expect(shell).toContain("localStorage.getItem('ops-sidebar-collapsed')")
    expect(shell).toContain("localStorage.setItem('ops-sidebar-collapsed', String(next))")
  })

  it('keeps authenticated TopNav free of duplicate mobile state while the extracted public nav owns its mobile menu', () => {
    expect(topNav).not.toContain('mobileOpen')
    expect(topNav).not.toContain('mobileMenuOpen')
    expect(publicNav).toContain('const [openOn, setOpenOn]')
    expect(sidebar).not.toContain('enabledCapabilities')
    expect(sidebar).not.toContain('role ===')
  })

  it('keeps responsive surfaces on the latest main application/brand tokens', () => {
    // Integration note (main + app visual convergence): main's B.x rollout pinned its own
    // inline chrome styling. The reviewed Phase B (TopNav / AppChrome.module.css) and Phase D1
    // (OpBar / Sidebar) implementations supersede that presentation, so this assertion now pins
    // the reviewed equivalent. Behavioural assertions in this file are unchanged.
    for (const token of ['--bg-base', '--bg-overlay', '--border', '--brand-brainbase-accent', '--text-primary', '--text-secondary', '--text-muted']) {
      expect(topNav + chromeCss).toContain(token)
    }
    expect(topNav + chromeCss).not.toMatch(/--purple-\d/)

  })
})
