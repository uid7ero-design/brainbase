import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
// Nav consolidation update (feat/authenticated-nav-consolidation): the pure
// nav model is imported so tenant invariants are pinned behaviourally too.
import {
  WORK_ITEMS,
  activeNavId,
  flattenNavLinks,
  resolveNav,
  type NavContext,
  type NavEntry,
  type NavGroup,
} from '@/components/nav/navModel'

// Phase C.2D — tenant-aware TopNav/LeftSidebar. Static source-text
// containment per this repo's convention (no jsdom/RTL harness); see
// AGENTS.md/CLAUDE.md and every prior phase's test file for the pattern.
//
// Nav consolidation update (feat/authenticated-nav-consolidation): TopNav no
// longer has the `isLdTennis ? (...) : (...)` branch pair, the
// isBrainbaseHQ/isSuperAdmin/hasEvents/hasCrm/hasOrganiser consts, or any
// `capability="..."` NavItem props. It renders ONE universal tree from
// components/nav/navModel.ts (resolveNav). Each C.2D / D.4.x invariant below
// is re-pinned against the navModel descriptors/gates (source) AND the pure
// resolveNav()/activeNavId() behaviour. APPROVED intent changes pinned here:
// HLNA -> /hlna for EVERY tenant (LD Tennis included); "Dashboard" is now
// "Home" (/dashboard) for everyone, Brainbase HQ included; Brainbase-internal
// tooling is gated on the REAL role super_admin (not the brainbase-hq
// variant); Organiser requires capability AND manager+.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf-8')

const topNavSource = read('components/nav/TopNav.tsx')
const layoutSource = read('app/layout.tsx')
const sidebarSource = read('components/layout/LeftSidebar.jsx')
const clientDashboardSource = read('lib/dashboard/clientDashboard.ts')
// Comments stripped so example descriptors in navModel.ts's own doc comment
// (e.g. a future 'assurance' module) are never counted as code.
const navModelSource = read('components/nav/navModel.ts')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

const ALL_CAPS = ['events', 'crm', 'quotes', 'organiser', 'people']
const VARIANTS: NavContext['dashboardVariant'][] = [null, 'ld-tennis', 'brainbase-hq']
const TENNIS_HREFS = ['/dashboard/leads', '/dashboard/contacts', '/dashboard/sessions', '/dashboard/blog']

function ctx(role: string, caps: string[] = [], dashboardVariant: NavContext['dashboardVariant'] = null): NavContext {
  return { role, enabledCapabilities: caps, dashboardVariant }
}
function hrefs(entries: readonly NavEntry[]): string[] {
  return entries.flatMap(e => (e.kind === 'group' ? e.children.map(c => c.href) : [e.href]))
}
function allHrefs(c: NavContext): string[] {
  return flattenNavLinks(resolveNav(c)).map(l => l.href)
}
function descriptor(id: string): string {
  const start = navModelSource.indexOf(`id: '${id}'`)
  expect(start, `descriptor ${id} not found`).toBeGreaterThan(-1)
  // A one-line descriptor (e.g. the INTERNAL Brainbase links) is exactly its
  // own line; a multi-line one ends at its closing brace.
  const lineEnd = navModelSource.indexOf('\n', start)
  if (/gate:/.test(navModelSource.slice(start, lineEnd))) return navModelSource.slice(start, lineEnd)
  const ends = ['\n  },', '\n};'].map(m => navModelSource.indexOf(m, start)).filter(i => i > -1)
  return navModelSource.slice(start, Math.min(...ends))
}

describe('Phase C.2D — the isClientOrg heuristic is gone', () => {
  it('TopNav no longer classifies tenants via enabledModules.length === 0', () => {
    expect(topNavSource).not.toContain('enabledModules.length === 0')
    expect(topNavSource).not.toContain('isClientOrg')
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): the
  // `dashboardVariant === 'ld-tennis'` / `=== 'brainbase-hq'` comparisons
  // moved out of TopNav into the navModel gates (tennis group
  // `variant: 'ld-tennis'`, Requests `hideForVariant: 'brainbase-hq'`),
  // evaluated against the same session.dashboardVariant TopNav passes in.
  it('classification is driven by the same dashboardVariant resolver app/dashboard/page.tsx uses, not a second system', () => {
    expect(topNavSource).toMatch(/const nav = resolveNav\(\{ role, enabledCapabilities, dashboardVariant \}\);/)
    expect(navModelSource).toMatch(/if \(gate\.variant && ctx\.dashboardVariant !== gate\.variant\) return false;/)
    expect(navModelSource).toMatch(/if \(gate\.hideForVariant && ctx\.dashboardVariant === gate\.hideForVariant\) return false;/)
    expect(navModelSource).toMatch(/gate: \{ variant: 'ld-tennis' \}/)
    expect(navModelSource).toMatch(/gate: \{ hideForVariant: 'brainbase-hq' \}/)
    // clientDashboard.ts itself is untouched — the resolver is reused, not
    // reimplemented or forked.
    expect(clientDashboardSource).toMatch(/BRAINBASE_SLUG = 'brainbase'/)
    expect(clientDashboardSource).toMatch(/'ld-tennis': 'ld-tennis'/)
  })

  it('app/layout.tsx resolves dashboardVariant server-side via resolveDashboardVariant and passes it to TopNav', () => {
    expect(layoutSource).toMatch(/import \{ resolveDashboardVariant \} from '@\/lib\/dashboard\/clientDashboard'/)
    expect(layoutSource).toMatch(/resolveDashboardVariant\(\s*session\.organisationId,\s*session\.role,?\s*\)/)
    // Nav consolidation update (feat/authenticated-nav-consolidation):
    // serverSession now ends with the approved display-only organisationName
    // after dashboardVariant (was `dashboardVariant,\n};`).
    expect(layoutSource).toMatch(/dashboardVariant,\s*\n\s*organisationName,?\s*\n?\s*\};/)
  })
})

describe('Phase C.2D — generic tenant navigation', () => {
  // Nav consolidation update (feat/authenticated-nav-consolidation): was a
  // `label="Dashboard"` NavItem under `!isBrainbaseHQ` in the generic
  // branch. APPROVED: it is now the universal "Home" pill -> /dashboard.
  it('generic tenants get a Home entry pointing at /dashboard', () => {
    expect(navModelSource).toMatch(/kind: 'link', id: 'home', label: 'Home', href: '\/dashboard', match: \['\/dashboard'\], exact: true,/)
    expect(topNavSource).toMatch(/<NavPill link=\{nav\.home\} active=\{activeId === nav\.home\.id\} \/>/)
    const home = resolveNav(ctx('manager', [], null)).home
    expect(home.label).toBe('Home')
    expect(home.href).toBe('/dashboard')
    expect(topNavSource).not.toMatch(/label="Dashboard"/)
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was the
  // generic branch's <HlnaItem href="/hlna">. Now the single HLNA_LINK.
  it('generic tenants get HLNA pointed at /hlna, not /dashboard', () => {
    expect(navModelSource).toMatch(/kind: 'link', id: 'hlna', label: 'HLNA', href: '\/hlna', match: \['\/hlna'\],/)
    expect(topNavSource).toMatch(/<NavPill link=\{nav\.hlna\} active=\{activeId === nav\.hlna\.id\} hlna \/>/)
    expect(resolveNav(ctx('manager', [], null)).hlna.href).toBe('/hlna')
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // `const hasEvents = enabledCapabilities.includes('events')` + `{hasEvents
  // && (` in TopNav. Now the Work "events" descriptor gated on
  // anyCapability ['events'] — still never an org name/slug.
  it('Events & Ticketing appears only when the \'events\' capability is enabled, never hardcoded to an org name', () => {
    const events = descriptor('events')
    expect(events).toMatch(/label: 'Events & Ticketing', href: '\/events', match: \['\/events'\],/)
    expect(events).toMatch(/gate: \{ anyCapability: \['events'\] \},/)
    // Never gated on a hardcoded org name/slug string.
    expect(events).not.toMatch(/organisation(Name|Slug)/i)
    expect(events).not.toContain('School Test')
    expect(topNavSource).not.toContain('School Test')
    for (const variant of VARIANTS) {
      expect(hrefs(resolveNav(ctx('manager', ['events'], variant)).work), `${variant}`).toContain('/events')
      expect(hrefs(resolveNav(ctx('manager', ['crm'], variant)).work), `${variant}`).not.toContain('/events')
    }
    const label = resolveNav(ctx('manager', ['events'])).work.find(e => e.id === 'events')?.label
    expect(label).toBe('Events & Ticketing')
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // `active={pathname.startsWith('/events')}`. Active state is now
  // activeNavId (segment-aware, longest match); /events is not `exact`.
  it('active-state matching for /events is prefix-based so /events/[id] still highlights it', () => {
    expect(descriptor('events')).not.toMatch(/exact: true/)
    const nav = resolveNav(ctx('manager', ['events']))
    expect(activeNavId(nav, '/events')).toBe('events')
    expect(activeNavId(nav, '/events/abc-123')).toBe('events')
    expect(activeNavId(nav, '/events/abc-123/registrations')).toBe('events')
    expect(activeNavId(nav, '/eventsx')).not.toBe('events')
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // `pathname.startsWith('/hlna')` on the generic <HlnaItem>.
  it('active-state matching for /hlna is prefix-based', () => {
    expect(descriptor('hlna')).not.toMatch(/exact: true/)
    const nav = resolveNav(ctx('manager', []))
    expect(activeNavId(nav, '/hlna')).toBe('hlna')
    expect(activeNavId(nav, '/hlna/session/1')).toBe('hlna')
  })
})

describe('Phase C.2D — a generic zero-module tenant does not receive the LD Tennis menu', () => {
  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // the `{isLdTennis ? (` JSX block containing Leads/SquadItem/Sessions/
  // Requests/Blog. Leads/Squad/Sessions/Blog are now the Work "Tennis"
  // group gated only on { variant: 'ld-tennis' }; Requests is the shared
  // REQUESTS_LINK (still offered to LD Tennis). Negative checks kept.
  it('the LD Tennis Leads/Squad/Sessions/Blog group is reachable only via dashboardVariant \'ld-tennis\', never via an enabledModules/enabledCapabilities length check', () => {
    const tennis = WORK_ITEMS.find((e): e is NavGroup => e.kind === 'group' && e.id === 'tennis')!
    expect(tennis.gate).toEqual({ variant: 'ld-tennis' })
    expect(tennis.children.map(c => c.label)).toEqual(['Leads', 'Squad', 'Sessions', 'Blog'])
    for (const child of tennis.children) expect(child.gate).toBeUndefined()
    // A zero-capability generic tenant gets no tennis entries; a
    // zero-capability LD Tennis tenant gets all of them plus Requests.
    for (const role of ['viewer', 'manager', 'admin', 'super_admin']) {
      const generic = allHrefs(ctx(role, [], null))
      for (const href of TENNIS_HREFS) expect(generic, `${role} ${href}`).not.toContain(href)
      const ld = allHrefs(ctx(role, [], 'ld-tennis'))
      for (const href of [...TENNIS_HREFS, '/dashboard/pipeline']) expect(ld, `${role} ${href}`).toContain(href)
    }
    // The gate itself is dashboardVariant === 'ld-tennis' — confirm no
    // *active* code path still branches on enabledModules (a handful of
    // harmless references remain: the Session type field and the dead
    // /api/me client-fetch fallback mapping, neither of which drives
    // this decision any more).
    expect(topNavSource).not.toContain('enabledModules.length')
    expect(topNavSource).not.toContain('isClientOrg')
    expect(navModelSource).not.toContain('enabledModules')
    expect(navModelSource).not.toMatch(/enabledCapabilities\.length/)
  })
})

describe('Phase C.2D — LD Tennis preservation', () => {
  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // "LD Tennis keeps its bespoke HLNA entry pointing at /dashboard".
  // APPROVED change: HLNA -> /hlna for EVERY tenant, LD Tennis included;
  // LD Tennis still reaches /dashboard via the universal Home pill.
  it('LD Tennis HLNA now points at /hlna like every tenant (approved), and LD Tennis still reaches /dashboard via Home', () => {
    for (const role of ['manager', 'super_admin']) {
      const nav = resolveNav(ctx(role, [], 'ld-tennis'))
      expect(nav.hlna.href).toBe('/hlna')
      expect(nav.home.href).toBe('/dashboard')
    }
    expect(topNavSource).not.toContain('HlnaItem')
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): the
  // five destinations moved from TopNav JSX into navModel descriptors;
  // pinned on the model source and on the resolved LD Tennis tree.
  it('all five bespoke LD Tennis nav destinations are unchanged from before this phase', () => {
    expect(navModelSource).toContain("href: '/dashboard/leads'")
    expect(navModelSource).toContain("href: '/dashboard/contacts'")
    expect(navModelSource).toContain("href: '/dashboard/sessions'")
    expect(navModelSource).toContain("href: '/dashboard/pipeline'")
    expect(navModelSource).toContain("href: '/dashboard/blog'")
    const ld = allHrefs(ctx('manager', [], 'ld-tennis'))
    for (const href of [...TENNIS_HREFS, '/dashboard/pipeline']) expect(ld).toContain(href)
  })
})

describe('Phase C.2D — Founder OS / super_admin preservation', () => {
  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // `isSuperAdmin && (<NavItem href="/admin/founder" label="Founder OS"`.
  // Now the INTERNAL Brainbase descriptor (internal = real super_admin).
  it('the Founder OS nav entry is untouched: still super_admin-gated, still points at /admin/founder', () => {
    expect(navModelSource).toMatch(/id: 'founder-os', label: 'Founder OS', href: '\/admin\/founder', match: \['\/admin\/founder'\], gate: INTERNAL/)
    expect(navModelSource).toMatch(/const INTERNAL: NavGate = \{ internal: true \};/)
    expect(navModelSource).toMatch(/if \(gate\.internal && ctx\.role !== 'super_admin'\) return false;/)
    for (const variant of VARIANTS) {
      expect(allHrefs(ctx('super_admin', [], variant)), `${variant}`).toContain('/admin/founder')
      for (const role of ['viewer', 'manager', 'admin']) {
        expect(allHrefs(ctx(role, ALL_CAPS, variant)), `${role}/${variant}`).not.toContain('/admin/founder')
      }
    }
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // "brainbase-hq super_admin does not get a redundant Dashboard entry".
  // APPROVED change: Home -> /dashboard is universal (Brainbase HQ
  // included). It is safe because /dashboard still redirects a Brainbase HQ
  // session to Founder OS, and Founder OS stays in the Brainbase menu.
  it('Home -> /dashboard is universal (approved), Brainbase HQ included — /dashboard still redirects Brainbase HQ to Founder OS, which remains offered', () => {
    const nav = resolveNav(ctx('super_admin', [], 'brainbase-hq'))
    expect(nav.home.href).toBe('/dashboard')
    expect(hrefs(nav.brainbase)).toContain('/admin/founder')
    expect(navModelSource).not.toMatch(/id: 'home'[^\n]*gate:/)
    const dashboardPageSource = read('app/dashboard/page.tsx')
    expect(dashboardPageSource).toMatch(/redirect\('\/admin\/founder'\)/)
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // Clients/AdminDropdown under isSuperAdmin and OpsDropdown/Reports/Data
  // under isBrainbaseHQ. APPROVED: all of them are INTERNAL Brainbase
  // descriptors (real super_admin, any variant). The "not any manager-role
  // tenant" intent is kept as negative checks across every variant.
  it('Clients, Platform (old AdminDropdown), Operations, Reports and Data are all super_admin-only (INTERNAL) — never shown to any manager/admin-role tenant', () => {
    for (const id of ['clients', 'operations', 'platform', 'data', 'reports']) {
      expect(descriptor(id), id).toMatch(/gate: INTERNAL/)
    }
    const internalHrefs = ['/clients', '/admin/orgs', '/dashboard/wste', '/reports', '/data']
    expect(allHrefs(ctx('super_admin', [], 'brainbase-hq'))).toEqual(expect.arrayContaining(internalHrefs))
    for (const variant of VARIANTS) {
      for (const role of ['viewer', 'manager', 'admin', 'analyst']) {
        const all = allHrefs(ctx(role, ALL_CAPS, variant))
        for (const href of internalHrefs) expect(all, `${role}/${variant} ${href}`).not.toContain(href)
      }
    }
    expect(topNavSource).not.toMatch(/OpsDropdown|AdminDropdown/)
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // `isBrainbaseHQ && (<NavItem href="/command"`. Now INTERNAL, separate
  // from Home.
  it('Command entry (/command) is super_admin-only (INTERNAL), not any manager-role tenant, and still separate from Home/Dashboard', () => {
    expect(navModelSource).toMatch(/id: 'command', label: 'Command', href: '\/command', match: \['\/command'\], gate: INTERNAL/)
    for (const variant of VARIANTS) {
      expect(allHrefs(ctx('manager', ALL_CAPS, variant)), `${variant}`).not.toContain('/command')
    }
    const nav = resolveNav(ctx('super_admin', [], 'brainbase-hq'))
    expect(activeNavId(nav, '/command')).toBe('command')
    expect(activeNavId(nav, '/dashboard')).toBe('home')
    // isManager itself is gone — Emma (role='manager', a client tenant)
    // must not qualify for Brainbase-internal tooling merely by role.
    expect(topNavSource).not.toMatch(/const isManager =/)
  })
})

describe('Phase C.2D — LeftSidebar (legacy-only path)', () => {
  it('the HLNA sidebar entry now routes to /hlna as a link, not the old activeModule=null + push(\'/dashboard\') behaviour', () => {
    const hlnaEntryMatch = sidebarSource.match(/key: 'hlna',[\s\S]{0,40}?type: '(\w+)',[\s\S]{0,80}?/)
    expect(hlnaEntryMatch).not.toBeNull()
    expect(sidebarSource).toMatch(/key: 'hlna',\s*label: 'HLNA',\s*type: 'link', href: '\/hlna'/)
  })

  it('LeftSidebar.jsx is confirmed legacy-only: reachable only through BrainBase.jsx, which is only rendered from the /dashboard auth-failure catch fallback', () => {
    // BrainBase.jsx is the only importer of this LeftSidebar.
    const brainBaseSource = read('components/BrainBase.jsx')
    expect(brainBaseSource).toMatch(/import \{ LeftSidebar \} from "\.\/layout\/LeftSidebar"/)
    // app/dashboard/page.tsx only renders <BrainBase /> from its auth
    // catch fallback — the generic/ld-tennis/brainbase-hq branches never
    // reach it (proven already by organisationDashboardSeparation.test.ts's
    // routing-matrix tests).
    const dashboardPageSource = read('app/dashboard/page.tsx')
    expect(dashboardPageSource).toMatch(/catch \{ return <BrainBase enabledCapabilities=\{\[\]\} \/> \}/)
  })
})

describe('Phase C.2D — containment', () => {
  it('does not change authentication, middleware, or the session model', () => {
    expect(topNavSource).not.toMatch(/from ['"].*middleware['"]/)
    expect(layoutSource).not.toMatch(/from ['"].*middleware['"]/)
    // getSession usage in layout.tsx predates this phase — confirm no new
    // session-shape fields were added beyond dashboardVariant.
    expect(layoutSource).toMatch(/avatarUrl\?: string;\s*\n\s*enabledCapabilities\?: string\[\];\s*\n\s*dashboardVariant\?: 'ld-tennis' \| 'brainbase-hq' \| null;/)
  })

  it('does not touch database schema or Prisma', () => {
    expect(topNavSource).not.toMatch(/prisma/i)
    expect(layoutSource).not.toMatch(/CREATE TABLE|ALTER TABLE/i)
  })

  it('does not touch /hlna interaction design, the AI prompt, or voice code', () => {
    const helenaWorkspace = read('components/helena/HelenaWorkspace.jsx')
    const chatRoute = read('app/api/chat/route.ts')
    expect(helenaWorkspace).not.toContain('dashboardVariant')
    expect(chatRoute).not.toContain('dashboardVariant')
  })

  it('does not touch Events business logic, ticketing, Stripe, or the public event routes', () => {
    expect(topNavSource).not.toMatch(/stripe/i)
    expect(topNavSource).not.toContain('registration')
    expect(topNavSource).not.toContain('ticket_id')
  })

  it('does not touch Founder OS implementation, LD Tennis dashboard implementation, or the C.2C OrganisationDashboard body', () => {
    const founderPage = read('app/admin/founder/page.tsx')
    const tennisDashboard = read('components/dashboard/TennisDashboard.tsx')
    const orgDashboard = read('components/dashboard/OrganisationDashboard.tsx')
    expect(founderPage).not.toContain('dashboardVariant')
    expect(tennisDashboard).not.toContain('dashboardVariant')
    expect(orgDashboard).not.toContain('dashboardVariant')
  })

  // Originally: "the separate founder-nav-dropdown-clipping hotfix is not
  // referenced or duplicated here", asserting TopNav had zero panelPos/
  // triggerRef presence — correct for C.2D, whose scope deliberately
  // excluded that hotfix. Phase C.2F integrated the verified fix from
  // hotfix/founder-nav-dropdown-clipping (commit 26d4596) into this
  // branch's TopNav.tsx (see tests/containment/
  // founderNavDropdownRegression.test.ts for the dedicated coverage of
  // that fix itself) — updated here to confirm the integration landed
  // rather than pinning the pre-C.2F absence.
  //
  // Updated AGAIN during the D.2.3 origin/main reconciliation merge:
  // C.2F's own plain-position:'fixed' implementation (panelPos/
  // triggerRef) was itself replaced with origin/main's independently-
  // developed createPortal(..., document.body) implementation (coords/
  // wrapperRef) — judged strictly more robust by the reconciliation
  // audit. The invariant this test protects — SOME dropdown-positioning
  // fix is integrated, not left as a separate unmerged hotfix — still
  // holds; only the specific mechanism's names changed.
  it('a founder-nav-dropdown-positioning fix is integrated directly into TopNav.tsx, not left as a separate unmerged hotfix', () => {
    expect(topNavSource).toContain('coords')
    expect(topNavSource).toContain('wrapperRef')
    expect(topNavSource).toContain('createPortal')
  })

  it('/dashboard still renders OrganisationDashboard for the generic fallthrough (C.2C untouched)', () => {
    const dashboardPageSource = read('app/dashboard/page.tsx')
    expect(dashboardPageSource).toMatch(/<OrganisationDashboard/)
    expect(dashboardPageSource).toMatch(/<TennisDashboard/)
    expect(dashboardPageSource).toMatch(/redirect\('\/admin\/founder'\)/)
  })
})

describe('Phase D.4.2 — capability icons did not touch the underlying gating this file protects', () => {
  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // `const hasEvents = enabledCapabilities.includes('events')` / `const
  // hasCrm = ...includes('crm')` in TopNav. The same gates are now the
  // descriptors' exact `anyCapability` lists; the icon is still additive
  // (a separate `icon` key), never a gate.
  it('the events/crm capability gates are exact single-capability gates, separate from the icon key — the icon is additive, never a new gate', () => {
    expect(descriptor('events')).toMatch(/icon: 'events',[\s\S]*gate: \{ anyCapability: \['events'\] \},/)
    expect(descriptor('crm')).toMatch(/icon: 'crm',[\s\S]*gate: \{ anyCapability: \['crm'\] \},/)
    expect(hrefs(resolveNav(ctx('viewer', ['crm'])).work)).toEqual(['/crm'])
    expect(hrefs(resolveNav(ctx('viewer', ['events'])).work)).toEqual(['/events'])
    expect(resolveNav(ctx('viewer', [])).work).toEqual([])
  })

  // Phase D.4.4E added a third real capability gate (hasOrganiser),
  // mirroring hasEvents/hasCrm exactly — every capability="..." prop in
  // this file is now one of events/crm/organiser, matching the three
  // gates that actually exist.
  // Nav consolidation update (feat/authenticated-nav-consolidation): TopNav
  // has no `capability="..."` literals any more (CapabilityIcon receives
  // capability={link.icon}); the icon keys live in navModel. Same contract:
  // every icon key is one of the five and sits on a descriptor whose gate
  // is that real capability (Commercial's 'quotes' icon: any of
  // quotes/invoicing/purchasing, mirroring app/commercial/layout.tsx).
  it('no capability id beyond events/crm/organiser/quotes/people was introduced — every icon key matches a real capability gate', () => {
    expect(topNavSource).not.toMatch(/capability="[a-zA-Z]+"/)
    expect(topNavSource).toMatch(/capability=\{link\.icon\}/)
    const iconKeys = navModelSource.match(/icon: '[a-zA-Z]+'/g) ?? []
    expect(iconKeys.length).toBeGreaterThan(0)
    for (const key of iconKeys) {
      expect(["icon: 'events'", "icon: 'crm'", "icon: 'organiser'", "icon: 'quotes'", "icon: 'people'"]).toContain(key)
    }
    const expectedGates: Record<string, string[]> = {
      events: ['events'], crm: ['crm'], organiser: ['organiser'], people: ['people'],
      commercial: ['quotes', 'invoicing', 'purchasing'],
    }
    const iconned = WORK_ITEMS.filter(e => e.kind === 'link' && e.icon)
    expect(iconned.map(e => e.id)).toEqual(['events', 'crm', 'commercial', 'organiser', 'people'])
    for (const e of iconned) expect(e.gate?.anyCapability, e.id).toEqual(expectedGates[e.id])
  })
})

describe('Phase D.4.4E — Organiser is a direct, capability-gated TopNav item, same pattern as Events/CRM', () => {
  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // `const hasOrganiser = enabledCapabilities.includes('organiser')` with no
  // role. APPROVED: the gate is now capability AND manager+ (mirrors
  // app/organiser/layout.tsx). Still never an organisation or variant.
  it('the Organiser gate is derived from enabledCapabilities (+ the approved manager+ floor), never hardcoded to any organisation or dashboardVariant', () => {
    const organiser = descriptor('organiser')
    expect(organiser).toMatch(/gate: \{ anyCapability: \['organiser'\], minRole: 'manager' \},/)
    expect(organiser).not.toMatch(/variant|internal|organisation(Name|Slug)/i)
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was a
  // `{hasOrganiser && (` NavItem in the shared JSX branch. Now the Work
  // descriptor, resolved for generic clients and Brainbase HQ alike.
  it('Organiser is offered in Work for generic clients and Brainbase HQ when the capability is enabled (manager+), and never without it', () => {
    for (const variant of [null, 'brainbase-hq'] as const) {
      for (const role of ['manager', 'admin', 'super_admin']) {
        expect(hrefs(resolveNav(ctx(role, ['organiser'], variant)).work), `${role}/${variant}`).toContain('/organiser')
        expect(hrefs(resolveNav(ctx(role, [], variant)).work), `${role}/${variant}`).not.toContain('/organiser')
      }
      expect(hrefs(resolveNav(ctx('viewer', ['organiser'], variant)).work)).not.toContain('/organiser')
    }
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was the
  // `{hasOrganiser && (` NavItem duplicated in the isLdTennis branch. Parity
  // is now structural (one tree); pinned behaviourally for LD Tennis.
  it('Organiser is also offered for LD Tennis under the same gate (parity with Events/CRM)', () => {
    expect(hrefs(resolveNav(ctx('manager', ['organiser'], 'ld-tennis')).work)).toContain('/organiser')
    expect(hrefs(resolveNav(ctx('manager', [], 'ld-tennis')).work)).not.toContain('/organiser')
    expect(hrefs(resolveNav(ctx('manager', ['events', 'crm', 'organiser'], 'ld-tennis')).work)).toEqual(
      expect.arrayContaining(['/events', '/crm', '/organiser']),
    )
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // `active={pathname.startsWith('/organiser')}`.
  it('the Organiser item points at /organiser with prefix-based active matching', () => {
    expect(descriptor('organiser')).toMatch(/label: 'Organiser', href: '\/organiser', match: \['\/organiser'\],/)
    expect(descriptor('organiser')).not.toMatch(/exact: true/)
    const nav = resolveNav(ctx('manager', ['organiser']))
    expect(activeNavId(nav, '/organiser')).toBe('organiser')
    expect(activeNavId(nav, '/organiser/boards/42')).toBe('organiser')
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // "label=\"Organiser\" exactly twice (one per JSX branch)". With one
  // universal tree it is exactly ONE descriptor, in Work — not in the
  // Brainbase/Operations menu, not a new dropdown.
  it('Organiser is exactly one Work descriptor — not inside the Brainbase/Operations menu, not a new dropdown', () => {
    expect((navModelSource.match(/label: 'Organiser'/g) ?? []).length).toBe(1)
    expect(topNavSource).not.toContain("'Organiser'")
    expect(topNavSource).not.toContain('label="Organiser"')
    expect(WORK_ITEMS.some(e => e.id === 'organiser')).toBe(true)
    const brainbaseStart = navModelSource.indexOf('export const BRAINBASE_ITEMS')
    const brainbaseEnd = navModelSource.indexOf('export const ACCOUNT_PROFILE_LINK', brainbaseStart)
    expect(navModelSource.slice(brainbaseStart, brainbaseEnd)).not.toContain('Organiser')
    expect(topNavSource).not.toMatch(/const TOOLS_ITEMS|function ToolsDropdown/)
  })
})
