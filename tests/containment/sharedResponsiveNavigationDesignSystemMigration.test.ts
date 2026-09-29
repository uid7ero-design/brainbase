import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { resolveNav } from '@/components/nav/navModel'

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

// Nav consolidation update (feat/authenticated-nav-consolidation): visibility
// rules now live in the pure nav model; read its source and use resolveNav().
const navModel = fs.readFileSync(
  path.resolve(__dirname, '../../components/nav/navModel.ts'),
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
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // hasEvents/hasCrm/... capability checks moved out of TopNav into
    // navModel.ts WORK_ITEMS gates (TopNav now only renders resolveNav()).
    // Each capability → href pairing is pinned on its descriptor AND
    // behaviourally. APPROVED change: Organiser additionally requires
    // manager+ (matching app/organiser/layout.tsx).
    for (const [href, gate] of [
      ['/events', "gate: { anyCapability: ['events'] }"],
      ['/crm', "gate: { anyCapability: ['crm'] }"],
      ['/commercial', "gate: { anyCapability: ['quotes', 'invoicing', 'purchasing'] }"],
      ['/organiser', "gate: { anyCapability: ['organiser'], minRole: 'manager' }"],
      ['/people', "gate: { anyCapability: ['people'], capabilityBypassRoles: ['super_admin'] }"],
    ]) {
      const at = navModel.indexOf(`href: '${href}'`)
      expect(at, href).toBeGreaterThan(-1)
      expect(navModel.slice(at, navModel.indexOf('\n  },', at)), href).toContain(gate)
    }
    expect(topNav).toContain('const nav = resolveNav({ role, enabledCapabilities, dashboardVariant });')
    expect(topNav).not.toMatch(/enabledCapabilities\.includes\(/)

    const hrefs = (role: string, caps: string[]) =>
      resolveNav({ role, enabledCapabilities: caps, dashboardVariant: null }).work.flatMap(e =>
        e.kind === 'group' ? e.children.map(c => c.href) : [e.href])
    expect(hrefs('manager', [])).toEqual(['/data-hub/import'])
    expect(hrefs('manager', ['events'])).toEqual(['/events', '/data-hub/import'])
    expect(hrefs('manager', ['crm'])).toEqual(['/crm', '/data-hub/import'])
    for (const cap of ['quotes', 'invoicing', 'purchasing']) {
      expect(hrefs('manager', [cap])).toEqual(['/commercial', '/data-hub/import'])
    }
    expect(hrefs('manager', ['organiser'])).toEqual(['/organiser', '/data-hub/import'])
    expect(hrefs('viewer', ['organiser'])).toEqual([])
    expect(hrefs('manager', ['people'])).toEqual(['/people', '/data-hub/import'])
  })

  it('preserves role visibility and super-admin-specific navigation boundaries', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // isSuperAdmin / isManagerPlus / admin-or-super_admin checks moved from
    // TopNav into navModel.ts (NAV_ROLE_ORDER + gates). Super-admin tools
    // (formerly AdminDropdown) are the Brainbase menu, internal-gated on the
    // REAL role; Branding keeps its admin+ floor (super_admin via role order).
    expect(navModel).toContain("export const NAV_ROLE_ORDER = ['viewer', 'manager', 'admin', 'super_admin'] as const;")
    expect(navModel).toContain("if (gate.internal && ctx.role !== 'super_admin') return false;")
    expect(navModel).toMatch(/label: 'Branding', href: '\/settings\/branding',[\s\S]*?gate: \{ minRole: 'admin' \}/)
    expect(topNav).toContain('{nav.brainbase.length > 0 && (')
    expect(topNav).toContain('<NavMenu label="Brainbase"')
    expect(topNav).not.toContain('<AdminDropdown')

    const nav = (role: string) => resolveNav({ role, enabledCapabilities: [], dashboardVariant: null })
    const manageHrefs = (role: string) => nav(role).manage.flatMap(e => (e.kind === 'link' ? [e.href] : []))
    expect(nav('super_admin').brainbase.length).toBeGreaterThan(0)
    for (const role of ['viewer', 'manager', 'admin', 'analyst']) {
      expect(nav(role).brainbase, role).toEqual([])
    }
    expect(manageHrefs('viewer')).toEqual([])
    expect(manageHrefs('manager')).toEqual(['/dashboard/integrations'])
    expect(manageHrefs('admin')).toEqual(['/dashboard/integrations', '/settings/branding'])
    expect(manageHrefs('super_admin')).toEqual(['/dashboard/integrations', '/settings/branding'])
  })

  it('preserves profile, logout, and responsive system-cluster interactions', () => {
    // Integration note (main + app visual convergence): main's B.x rollout pinned its own
    // inline chrome styling. The reviewed Phase B (TopNav / AppChrome.module.css) and Phase D1
    // (OpBar / Sidebar) implementations supersede that presentation, so this assertion now pins
    // the reviewed equivalent. Behavioural assertions in this file are unchanged.
    // Nav consolidation update (feat/authenticated-nav-consolidation): My
    // profile is now the Account menu's model link (ACCOUNT_PROFILE_LINK,
    // rendered via MenuLink href={link.href}); Sign out keeps the same dynamic
    // import of logout, now inside SignOutMenuItem (one level shallower, so
    // the indentation changed). Both are in AccountEntries, used by the
    // desktop Account menu AND the mobile menu.
    expect(navModel).toContain("label: 'My profile', href: '/account/profile'")
    expect(topNav).toContain('<MenuLink link={nav.account.profile}')
    expect(topNav).toContain("await import(\n              '@/app/actions/auth'")
    expect(topNav).toContain('await logout()')
    expect((topNav.match(/<AccountEntries nav=\{nav\}/g) ?? []).length).toBe(2)
    expect(topNav).toContain('flexShrink: 0')

  })

  it('preserves dropdown portal interaction so narrow navigation is not clipped by the scroll container', () => {
    // Integration note (main + app visual convergence): main's B.x rollout pinned its own
    // inline chrome styling. The reviewed Phase B (TopNav / AppChrome.module.css) and Phase D1
    // (OpBar / Sidebar) implementations supersede that presentation, so this assertion now pins
    // the reviewed equivalent. Behavioural assertions in this file are unchanged.
    // Nav consolidation update (feat/authenticated-nav-consolidation): the 2
    // portals are now the generic NavMenu (every desktop menu) + MobileMenu;
    // the measured `rect.bottom + 6` offset lives once, in NavMenu.
    expect(topNav.match(/createPortal\(/g)?.length).toBe(2)
    expect(topNav).toContain("overflowX: 'auto'")
    expect(topNav.match(/top: rect\.bottom \+ 6/g)?.length).toBe(1)
    const navMenu = topNav.slice(topNav.indexOf('function NavMenu('), topNav.indexOf('\nfunction ', topNav.indexOf('function NavMenu(') + 1))
    expect(navMenu).toContain('top: rect.bottom + 6')
    expect(navMenu).toMatch(/createPortal\([\s\S]*?document\.body,/)

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
