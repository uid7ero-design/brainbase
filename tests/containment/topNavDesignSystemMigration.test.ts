import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { resolveNav } from '@/components/nav/navModel'

const source = fs.readFileSync(path.resolve(__dirname, '../../components/nav/TopNav.tsx'),'utf-8').replace(/\r\n/g,'\n')
// Nav consolidation update (feat/authenticated-nav-consolidation): route and
// visibility descriptors now live in the pure nav model.
const navModel = fs.readFileSync(path.resolve(__dirname, '../../components/nav/navModel.ts'),'utf-8').replace(/\r\n/g,'\n')
const chromeCss = fs.readFileSync(path.resolve(__dirname, '../../components/nav/AppChrome.module.css'),'utf-8')

describe('B.1 TopNav design-system migration after main convergence', () => {
  it('uses the latest main application/brand tokens', () => {
    // Integration note: the reviewed Phase B chrome keeps its treatment in AppChrome.module.css on the
    // Phase A app tokens; the retired --purple-* ramp is intentionally no longer used.
    for (const token of ['--bg-base','--bg-overlay','--border','--brand-brainbase-accent','--text-primary','--text-secondary','--text-muted']) expect(source + chromeCss).toContain(token)
    expect(source + chromeCss).not.toMatch(/--purple-\d/)
  })
  it('preserves routing and capability visibility', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // hasOrganiser/hasCrm/hasPeople/hasCommercial checks and the literal hrefs
    // moved from TopNav into navModel.ts descriptors; TopNav renders
    // resolveNav(). Each route is pinned on the model with its gate, and
    // visibility is asserted behaviourally.
    expect(source).toContain('const nav = resolveNav({ role, enabledCapabilities, dashboardVariant });')
    for (const [href, gate] of [
      ['/organiser', "gate: { anyCapability: ['organiser'], minRole: 'manager' }"],
      ['/crm', "gate: { anyCapability: ['crm'] }"],
      ['/people', "gate: { anyCapability: ['people'], capabilityBypassRoles: ['super_admin'] }"],
      ['/commercial', "gate: { anyCapability: ['quotes', 'invoicing', 'purchasing'] }"],
      ['/data-hub/import', "gate: { minRole: 'manager' }"],
    ]) {
      const at = navModel.indexOf(`href: '${href}'`)
      expect(at, href).toBeGreaterThan(-1)
      expect(navModel.slice(at, navModel.indexOf('\n  },', at)), href).toContain(gate)
    }
    expect(navModel).toContain("label: 'Reports', href: '/reports'")
    expect(navModel).toContain("label: 'Data', href: '/data'")

    const hrefs = (role: string, caps: string[]) => {
      const nav = resolveNav({ role, enabledCapabilities: caps, dashboardVariant: null })
      return [...nav.work, ...nav.brainbase].flatMap(e => (e.kind === 'group' ? e.children.map(c => c.href) : [e.href]))
    }
    const all = ['events', 'crm', 'quotes', 'organiser', 'people']
    for (const href of ['/organiser', '/commercial', '/people', '/data-hub/import', '/reports', '/data', '/crm']) {
      expect(hrefs('super_admin', all), href).toContain(href)
    }
    // Capability-gated routes disappear without their capability; internal
    // Data/Reports never reach a non-super_admin.
    const managerNoCaps = hrefs('manager', [])
    for (const href of ['/organiser', '/commercial', '/crm', '/reports', '/data']) {
      expect(managerNoCaps, href).not.toContain(href)
    }
    expect(managerNoCaps).toEqual(['/data-hub/import'])
    expect(hrefs('viewer', all)).not.toContain('/data-hub/import')
  })
  it('preserves dropdown portals and the certified overflow strategy', () => {
    expect(source.match(/createPortal\(/g)?.length).toBe(2)
    // Desktop header refinement — the centre row is now genuinely centred
    // (justifyContent: 'center', matching the three-zone grid's own
    // centring at >=960px) rather than packed to the left; the overflow
    // safety net for a persona with many items is unchanged.
    expect(source).toContain("justifyContent: 'center'")
    expect(source).toContain("overflowX: 'auto'")
    expect(source).toContain("overflowY: 'hidden'")
  })
  it('preserves session, logout, and public-event suppression behavior', () => {
    expect(source).toContain("fetch('/api/me')")
    expect(source).toContain('await logout()')
    expect(source).toContain('resolvePublicEventTheme(')
    expect(source).toContain("'/tennis'")
    expect(source).toContain("'/connect'")
  })
  it('does not add persistence or backend dependencies', () => {
    expect(source).not.toMatch(/@\/lib\/(db|auth|session)/)
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('sql`')
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // same no-backend/no-persistence rule now also covers the nav model that
    // TopNav imports (it must stay pure and client-safe).
    expect(navModel).not.toMatch(/^import /m)
    expect(navModel).not.toContain('localStorage')
    expect(navModel).not.toContain('sessionStorage')
  })
})
