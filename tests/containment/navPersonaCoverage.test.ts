import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
// Nav consolidation update (feat/authenticated-nav-consolidation): the pure
// nav model is imported so persona invariants are pinned behaviourally too.
import {
  BRAINBASE_ITEMS,
  flattenNavLinks,
  isGateOpen,
  resolveNav,
  type NavContext,
  type NavEntry,
  type NavGroup,
  type NavLink,
} from '@/components/nav/navModel'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness (same caveat as
// every other *StaticCheck.test.ts / containment test in this suite).
//
// Root of this file: a Production report that founder/super_admin's
// Operations and Admin dropdown BUTTONS render, but their CONTENT is
// empty. Investigated exhaustively (see the accompanying report) by
// diffing every navigation-relevant file between pre-PR-72 main
// (a1835eed) and current main (cd53fab): TopNav.tsx's OPS_ITEMS array is
// byte-identical before/after; ADMIN_ITEMS only gained one new entry
// (Client Events); the isManager/isSuperAdmin gates controlling whether
// OpsDropdown/AdminDropdown render at all are untouched; app/layout.tsx
// and app/api/me/route.ts's enabledCapabilities computation blocks are
// untouched (only additively gained dashboardVariant). No code-level
// regression was found. These tests exist regardless, to (a) prove and
// permanently lock in the actual invariant — founder navigation content
// is NOT filtered by enabledModules, which IS a real, separate,
// pre-existing bug (organisation_modules.module_id/modules.id don't
// exist in the real schema) that keeps enabledModules permanently empty
// — and (b) cover all three real nav personas explicitly, since the
// prior test suite never asserted dropdown CONTENTS for any of them.

// While live-verifying Emma's nav during this investigation, a second,
// separate, pre-existing leak was found (not the reported bug's cause,
// but explicitly required to be fixed per this task's own "EMMA /
// GENERIC CLIENT: ... NO Admin" acceptance criterion): the client
// dashboard's LEFT sidebar (components/layout/LeftSidebar.jsx, part of
// the BrainBase.jsx shell every generic client — including School Test
// Organisation — lands on) rendered a static, unconditional 'Admin'
// entry (-> /admin/orgs) to every organisation reaching that shell,
// with no role gating at all. Fixed by threading isSuperAdmin down from
// app/dashboard/page.tsx's own session (already resolved server-side)
// through BrainBase.jsx into LeftSidebar, and filtering that one entry
// out unless true. Gated on the flag (not simply deleted) because a
// super_admin impersonating a client organisation still reaches this
// same shell with role/isSuperAdmin still true and should keep it.

// UPDATED WHOLESALE during the D.2.3 origin/main reconciliation merge.
// The isClientOrg heuristic this file originally targeted no longer
// exists — C.2D's rewrite (already the architecture on this branch
// before the merge) replaced it with dashboardVariant-driven
// isLdTennis/isBrainbaseHQ classification, and AppNav's top-level
// branch pair became `isLdTennis ? ( <LD Tennis's own bespoke nav,
// fully separate> ) : ( <SHARED branch: generic clients AND
// Brainbase-internal staff together, each item individually gated
// within it by isBrainbaseHQ/isSuperAdmin/hasEvents/!isBrainbaseHQ> )`.
// This is a real architectural difference from the old two-way
// isClientOrg split this file assumed, not just a renaming: a generic
// client (Persona 2) and Brainbase HQ staff (Persona 1) now render from
// the SAME JSX region, distinguished only by which individual gates
// evaluate true for their session — so "founder items are physically
// absent from the client region" is no longer the right assertion for
// Persona 2; "founder items are individually gated behind
// isBrainbaseHQ/isSuperAdmin, both of which are false for a generic
// client" is. isManager is gone entirely (superseded by the narrower,
// org-identity-aware isBrainbaseHQ — see components/nav/TopNav.tsx's own
// comment on that gate, and tests/containment/founderNavDropdownRegression
// .test.ts for the dedicated dropdown-gating suite).

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// Nav consolidation update (feat/authenticated-nav-consolidation): the
// two-branch `isLdTennis ? (...) : (...)` AppNav, OpsDropdown/AdminDropdown,
// OPS_ITEMS/ADMIN_ITEMS and the isBrainbaseHQ/isSuperAdmin/hasEvents JSX
// gates no longer exist. TopNav now renders ONE universal tree resolved by
// components/nav/navModel.ts (resolveNav). Every persona invariant below is
// re-pinned against (a) the descriptor/gate source in navModel.ts and (b)
// behaviour via the pure resolveNav() — strictly stronger than the old
// JSX-region text matching. APPROVED changes relative to the old pins:
// Operations + Platform (old Ops/Admin dropdowns) now live in the single
// "Brainbase" menu, visible iff the REAL role is super_admin independent of
// dashboardVariant (so an impersonating super_admin viewing LD Tennis keeps
// it); the old Operations "CRM" duplicate is gone (CRM lives in Work); the
// old Admin "Pipeline" entry is "Client requests" (/admin/pipeline).

const topNavSource = stripComments(read('components/nav/TopNav.tsx'))
const navModelSource = stripComments(read('components/nav/navModel.ts'))

function sliceBetween(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker)
  expect(start, `${startMarker} not found`).toBeGreaterThan(-1)
  const end = src.indexOf(endMarker, start + startMarker.length)
  expect(end, `${endMarker} not found after ${startMarker}`).toBeGreaterThan(-1)
  return src.slice(start, end)
}

const workItemsSource = sliceBetween(navModelSource, 'export const WORK_ITEMS', 'export const REQUESTS_LINK')
const brainbaseItemsSource = sliceBetween(navModelSource, 'export const BRAINBASE_ITEMS', 'export const ACCOUNT_PROFILE_LINK')

const ALL_CAPS = ['events', 'crm', 'quotes', 'organiser', 'people']
const VARIANTS: NavContext['dashboardVariant'][] = [null, 'ld-tennis', 'brainbase-hq']
const NON_SUPER_ROLES = ['viewer', 'manager', 'admin', 'analyst']

function ctx(role: string, caps: string[] = [], dashboardVariant: NavContext['dashboardVariant'] = null): NavContext {
  return { role, enabledCapabilities: caps, dashboardVariant }
}
function hrefs(entries: readonly NavEntry[]): string[] {
  return entries.flatMap(e => (e.kind === 'group' ? e.children.map(c => c.href) : [e.href]))
}
function allHrefs(c: NavContext): string[] {
  return flattenNavLinks(resolveNav(c)).map(l => l.href)
}
function group(entries: readonly NavEntry[], id: string): NavGroup | undefined {
  return entries.find((e): e is NavGroup => e.kind === 'group' && e.id === id)
}

const FOUNDER = ctx('super_admin', [], 'brainbase-hq')
const INTERNAL_HREFS = [
  '/admin/founder', '/command', '/clients', '/admin/pipeline',
  '/dashboard/wste', '/dashboard/fleet', '/dashboard/social', '/dashboards',
  '/data', '/reports',
  '/admin/orgs', '/admin/users', '/admin/client-events', '/onboarding',
]
const TENNIS_HREFS = ['/dashboard/leads', '/dashboard/contacts', '/dashboard/sessions', '/dashboard/blog']

describe('Persona 1 — Founder / super_admin: Operations and Admin dropdowns are populated, independent of enabledModules', () => {
  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // `{isBrainbaseHQ && (<OpsDropdown` in the shared branch and absent from
  // the LD Tennis branch. OpsDropdown's content is now the Brainbase menu's
  // internal-gated "Operations" group, rendered by the single generic
  // NavMenu only when resolveNav() yields a non-empty `brainbase` list.
  it('the Operations group (old OpsDropdown) is an internal-gated group inside the Brainbase menu, rendered only when nav.brainbase is non-empty — shown to a real super_admin, never to any non-super_admin in any tenant variant', () => {
    expect(topNavSource).not.toContain('OpsDropdown')
    expect(topNavSource).toMatch(/\{nav\.brainbase\.length > 0 && \(\s*\n\s*<NavMenu label="Brainbase"/)
    expect(brainbaseItemsSource).toMatch(/kind: 'group', id: 'operations', label: 'Operations', gate: INTERNAL,/)
    expect(navModelSource).toMatch(/const INTERNAL: NavGate = \{ internal: true \};/)
    expect(group(resolveNav(FOUNDER).brainbase, 'operations')).toBeDefined()
    for (const variant of VARIANTS) {
      for (const role of NON_SUPER_ROLES) {
        expect(resolveNav(ctx(role, ALL_CAPS, variant)).brainbase, `${role}/${variant}`).toEqual([])
      }
    }
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // `{isSuperAdmin && (<AdminDropdown`. AdminDropdown's content is now the
  // Brainbase menu's internal-gated "Platform" group.
  it('the Platform group (old AdminDropdown) is internal-gated inside the Brainbase menu — present for a real super_admin in every variant, never for a non-super_admin', () => {
    expect(topNavSource).not.toContain('AdminDropdown')
    expect(brainbaseItemsSource).toMatch(/kind: 'group', id: 'platform', label: 'Platform', gate: INTERNAL,/)
    for (const variant of VARIANTS) {
      expect(group(resolveNav(ctx('super_admin', [], variant)).brainbase, 'platform'), `super_admin/${variant}`).toBeDefined()
      for (const role of NON_SUPER_ROLES) {
        expect(group(resolveNav(ctx(role, ALL_CAPS, variant)).brainbase, 'platform'), `${role}/${variant}`).toBeUndefined()
      }
    }
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // OPS_ITEMS containing Waste, Fleet, Social and a capability-gated CRM.
  // APPROVED: the Operations "CRM" duplicate is gone (CRM lives in Work);
  // "All dashboards" (/dashboards) joins Operations.
  it('the Operations group contains exactly Waste, Fleet, Social and All dashboards (unconditional for a super_admin) — and no CRM duplicate; CRM lives in Work, capability-gated', () => {
    const ops = group(resolveNav(FOUNDER).brainbase, 'operations')!
    expect(ops.children.map(c => [c.label, c.href])).toEqual([
      ['Waste', '/dashboard/wste'],
      ['Fleet', '/dashboard/fleet'],
      ['Social', '/dashboard/social'],
      ['All dashboards', '/dashboards'],
    ])
    expect(brainbaseItemsSource).not.toMatch(/label: 'CRM'/)
    expect(hrefs(resolveNav(ctx('super_admin', ALL_CAPS, 'brainbase-hq')).brainbase)).not.toContain('/crm')
    expect(workItemsSource).toMatch(/id: 'crm', label: 'CRM', href: '\/crm'[\s\S]{0,160}?gate: \{ anyCapability: \['crm'\] \}/)
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // ADMIN_ITEMS containing Organisations, Users, Client Events, Pipeline,
  // Setup. APPROVED: "Pipeline" is now the top-level Brainbase entry
  // "Client requests" (same /admin/pipeline destination).
  it('the Platform group contains Organisations, Users, Client Events, Setup, and the old Admin "Pipeline" is the Brainbase "Client requests" entry (/admin/pipeline)', () => {
    const nav = resolveNav(FOUNDER)
    const platform = group(nav.brainbase, 'platform')!
    expect(platform.children.map(c => [c.label, c.href])).toEqual([
      ['Organisations', '/admin/orgs'],
      ['Users', '/admin/users'],
      ['Client Events', '/admin/client-events'],
      ['Setup', '/onboarding'],
    ])
    const clientRequests = nav.brainbase.find(e => e.kind === 'link' && e.id === 'client-requests') as NavLink | undefined
    expect(clientRequests?.label).toBe('Client requests')
    expect(clientRequests?.href).toBe('/admin/pipeline')
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was "no
  // ADMIN_ITEMS.filter between the array and its render map". The rendered
  // list is now resolveNav().brainbase; the equivalent (stronger) invariant
  // is that every Brainbase descriptor's gate is exactly INTERNAL, so for a
  // super_admin NO capability/module/variant/role-floor can empty any of it.
  it('the Brainbase tree is unconditional for a super_admin — every descriptor is gated exactly INTERNAL (no capability/variant/minRole gate), so the full tree resolves for any capabilities and any variant', () => {
    const gates = brainbaseItemsSource.match(/gate:\s*(\{|\w+)/g) ?? []
    expect(gates.length).toBe(17) // 4 top-level links + 3 groups + 10 children
    for (const g of gates) expect(g).toBe('gate: INTERNAL')
    expect(brainbaseItemsSource).not.toMatch(/anyCapability|minRole|variant|hideForVariant/)
    const full = hrefs(BRAINBASE_ITEMS)
    expect(full.sort()).toEqual([...INTERNAL_HREFS].sort())
    for (const variant of VARIANTS) {
      for (const caps of [[], ALL_CAPS]) {
        expect(hrefs(resolveNav(ctx('super_admin', caps, variant)).brainbase).sort(), `${variant}/${caps.length}`).toEqual(full)
      }
    }
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was "no
  // enabledModules in the OpsDropdown/AdminDropdown definitions". Those
  // definitions are gone; the equivalent is that the visibility model never
  // sees enabledModules at all and TopNav feeds it only role, capabilities
  // and dashboardVariant.
  it('visibility is keyed on role/enabledCapabilities/dashboardVariant only — enabledModules is never referenced in navModel.ts, never passed to resolveNav, and never referenced by the generic NavMenu/MenuEntries renderers', () => {
    expect(navModelSource).not.toMatch(/enabledModules/)
    expect(navModelSource).toMatch(/export type NavContext = \{\s*\n\s*role: string;\s*\n\s*enabledCapabilities: readonly string\[\];\s*\n\s*dashboardVariant: DashboardVariant;\s*\n\s*\};/)
    expect(topNavSource).toMatch(/const nav = resolveNav\(\{ role, enabledCapabilities, dashboardVariant \}\);/)
    const renderers = sliceBetween(topNavSource, 'function NavMenu(', 'function Logo()')
    expect(renderers).not.toMatch(/enabledModules/)
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // `const isLdTennis = dashboardVariant === 'ld-tennis'` / `const
  // isBrainbaseHQ = dashboardVariant === 'brainbase-hq'` in TopNav. TopNav no
  // longer derives either; the single dashboardVariant field is compared only
  // inside navModel's isGateOpen, and the internal (founder) gate is keyed on
  // the REAL role alone — never on enabledModules/enabledCapabilities.
  it('tenant variant is still ONE field (DashboardVariant = \'ld-tennis\' | \'brainbase-hq\' | null) compared only inside isGateOpen; TopNav has no isLdTennis/isBrainbaseHQ branching; founder tools are keyed on role === \'super_admin\' alone, never on capabilities', () => {
    expect(navModelSource).toMatch(/export type DashboardVariant = 'ld-tennis' \| 'brainbase-hq' \| null;/)
    expect(navModelSource).toMatch(/if \(gate\.internal && ctx\.role !== 'super_admin'\) return false;/)
    expect(navModelSource).toMatch(/if \(gate\.variant && ctx\.dashboardVariant !== gate\.variant\) return false;/)
    expect(navModelSource).toMatch(/if \(gate\.hideForVariant && ctx\.dashboardVariant === gate\.hideForVariant\) return false;/)
    expect(topNavSource).not.toMatch(/isLdTennis|isBrainbaseHQ|isSuperAdmin/)
    expect(topNavSource).not.toMatch(/dashboardVariant\s*===/)
    // A non-super_admin at a brainbase-hq-variant org (unreachable per the
    // resolver's own role gate, defensive here) still gets no founder tools,
    // even with every capability enabled.
    expect(resolveNav(ctx('manager', ALL_CAPS, 'brainbase-hq')).brainbase).toEqual([])
    expect(isGateOpen({ internal: true }, ctx('admin', ALL_CAPS, 'brainbase-hq'))).toBe(false)
    expect(isGateOpen({ internal: true }, ctx('super_admin', [], null))).toBe(true)
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // `{isSuperAdmin && (<NavItem href="/admin/founder"` / `href="/clients"` in
  // the shared branch only. Both are now INTERNAL Brainbase descriptors.
  it('Founder OS and Clients are INTERNAL Brainbase entries — never gated on enabledModules, visible to a real super_admin, and never to any non-super_admin (including every LD Tennis role)', () => {
    expect(brainbaseItemsSource).toMatch(/id: 'founder-os', label: 'Founder OS', href: '\/admin\/founder', match: \['\/admin\/founder'\], gate: INTERNAL/)
    expect(brainbaseItemsSource).toMatch(/id: 'clients', label: 'Clients', href: '\/clients', match: \['\/clients'\], gate: INTERNAL/)
    expect(hrefs(resolveNav(FOUNDER).brainbase)).toEqual(expect.arrayContaining(['/admin/founder', '/clients']))
    for (const variant of VARIANTS) {
      for (const role of NON_SUPER_ROLES) {
        const all = allHrefs(ctx(role, ALL_CAPS, variant))
        expect(all, `${role}/${variant}`).not.toContain('/admin/founder')
        expect(all, `${role}/${variant}`).not.toContain('/clients')
      }
    }
  })
})

describe('Persona 2 — generic client manager (e.g. School Test Organisation): no founder items leak in', () => {
  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // "each founder surface in the shared branch is preceded by an
  // isBrainbaseHQ/isSuperAdmin JSX gate". Every founder surface is now a
  // descriptor in BRAINBASE_ITEMS gated INTERNAL, and TopNav hardcodes none
  // of their hrefs — so a generic client can reach none of them.
  it('every founder-only surface (Operations, Platform, Founder OS, Clients, Client requests, Reports, Data, Command) is an INTERNAL descriptor, TopNav hardcodes none of them, and a generic client in any role sees none of them anywhere in the resolved tree', () => {
    for (const href of INTERNAL_HREFS) {
      const esc = href.replace(/\//g, '\\/')
      expect(brainbaseItemsSource, href).toMatch(new RegExp(`href: '${esc}', match: \\['${esc}'\\], gate: INTERNAL`))
      expect(topNavSource, href).not.toContain(`'${href}'`)
      expect(topNavSource, href).not.toContain(`"${href}"`)
    }
    for (const role of NON_SUPER_ROLES) {
      const nav = resolveNav(ctx(role, ALL_CAPS, null))
      expect(nav.brainbase, role).toEqual([])
      const all = flattenNavLinks(nav).map(l => l.href)
      for (const href of INTERNAL_HREFS) expect(all, `${role} ${href}`).not.toContain(href)
    }
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // `{hasEvents && (` and Requests under `{!isBrainbaseHQ && (`. Events is
  // now the Work descriptor gated on the 'events' capability; Requests is
  // REQUESTS_LINK gated only on hideForVariant 'brainbase-hq'.
  it('Events & Ticketing is visible exactly when enabledCapabilities includes \'events\', and Requests is visible for every non-brainbase-hq tenant (gated only on hideForVariant: \'brainbase-hq\')', () => {
    expect(workItemsSource).toMatch(/id: 'events', label: 'Events & Ticketing', href: '\/events'[\s\S]{0,200}?gate: \{ anyCapability: \['events'\] \}/)
    expect(navModelSource).toMatch(/label: 'Requests', href: '\/dashboard\/pipeline', match: \['\/dashboard\/pipeline'\],\s*\n\s*gate: \{ hideForVariant: 'brainbase-hq' \},/)
    expect(hrefs(resolveNav(ctx('manager', ['events'])).work)).toContain('/events')
    expect(hrefs(resolveNav(ctx('manager', [])).work)).not.toContain('/events')
    expect(resolveNav(ctx('manager', [], null)).requests?.href).toBe('/dashboard/pipeline')
    expect(resolveNav(ctx('manager', [], 'ld-tennis')).requests?.href).toBe('/dashboard/pipeline')
    expect(resolveNav(ctx('super_admin', [], 'brainbase-hq')).requests).toBeNull()
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // "Leads/Squad/Sessions/Blog absent from the shared JSX branch". They are
  // now only the children of the Work "Tennis" group, gated on
  // { variant: 'ld-tennis' }; TopNav hardcodes none of them.
  it('Squad, Sessions, Leads, and Blog exist only inside the Tennis group gated on { variant: \'ld-tennis\' } — a generic client organisation never sees them, in any role or capability set', () => {
    const tennis = sliceBetween(workItemsSource, "kind: 'group', id: 'tennis'", ']')
    expect(tennis).toMatch(/gate: \{ variant: 'ld-tennis' \}/)
    for (const href of TENNIS_HREFS) {
      expect(topNavSource).not.toContain(href)
      expect(navModelSource.split(`href: '${href}'`).length - 1, href).toBe(1)
    }
    expect(topNavSource).not.toContain('SquadItem')
    for (const role of ['viewer', 'manager', 'admin', 'super_admin']) {
      const all = allHrefs(ctx(role, ALL_CAPS, null))
      for (const href of TENNIS_HREFS) expect(all, `${role} ${href}`).not.toContain(href)
    }
  })
})

describe('Persona 3 — LD Tennis manager: full tennis navigation retained, founder tools never leak in', () => {
  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // "the isLdTennis-true JSX branch never references OpsDropdown/
  // AdminDropdown". There is no LD Tennis branch now; the equivalent is that
  // an LD Tennis (non-super_admin) session resolves an empty Brainbase menu.
  // APPROVED: a REAL super_admin impersonating LD Tennis keeps Brainbase.
  it('an LD Tennis session in any non-super_admin role resolves NO Brainbase menu (no Operations/Platform) — founder tools depend on the real role, never on the tenant; a real super_admin viewing LD Tennis keeps them (approved)', () => {
    expect(topNavSource).not.toMatch(/isLdTennis/)
    for (const role of NON_SUPER_ROLES) {
      expect(resolveNav(ctx(role, ALL_CAPS, 'ld-tennis')).brainbase, role).toEqual([])
    }
    const impersonating = resolveNav(ctx('super_admin', [], 'ld-tennis'))
    expect(group(impersonating.brainbase, 'operations')).toBeDefined()
    expect(group(impersonating.brainbase, 'platform')).toBeDefined()
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was the
  // LD Tennis JSX region containing each href + SquadItem +
  // `enabledCapabilities.includes('events')`. Now asserted behaviourally
  // through resolveNav for the LD Tennis variant.
  it('Leads, Squad, Sessions, Blog, Requests, and Events are all reachable for an LD Tennis manager (tennis via the variant gate, Events via its capability)', () => {
    const nav = resolveNav(ctx('manager', ['events'], 'ld-tennis'))
    const tennis = group(nav.work, 'tennis')!
    expect(tennis.children.map(c => [c.label, c.href])).toEqual([
      ['Leads', '/dashboard/leads'],
      ['Squad', '/dashboard/contacts'],
      ['Sessions', '/dashboard/sessions'],
      ['Blog', '/dashboard/blog'],
    ])
    expect(nav.requests?.href).toBe('/dashboard/pipeline')
    expect(hrefs(nav.work)).toContain('/events')
    // Events stays capability-gated for LD Tennis too.
    expect(hrefs(resolveNav(ctx('manager', [], 'ld-tennis')).work)).not.toContain('/events')
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was a
  // text check on the LD Tennis JSX region; now behavioural over every
  // non-super_admin LD Tennis role and the whole resolved tree.
  it('no founder Admin tool (Platform group, /admin/founder, /clients) is reachable by an LD Tennis non-super_admin session', () => {
    for (const role of NON_SUPER_ROLES) {
      const all = allHrefs(ctx(role, ALL_CAPS, 'ld-tennis'))
      for (const href of INTERNAL_HREFS) expect(all, `${role} ${href}`).not.toContain(href)
    }
  })
})

describe('LeftSidebar — the client dashboard shell\'s own Admin leak (found during live verification, required by Emma\'s "NO Admin" acceptance criterion)', () => {
  const sidebarSource = read('components/layout/LeftSidebar.jsx')
  const brainBaseSource = read('components/BrainBase.jsx')
  const pageSource = read('app/dashboard/page.tsx')

  it('the admin SIDEBAR_NAV entry is excluded unless isSuperAdmin is true — never shown unconditionally', () => {
    expect(sidebarSource).toMatch(/const sidebarNav = useMemo\(\s*\n\s*\(\) => \(isSuperAdmin \? SIDEBAR_NAV : SIDEBAR_NAV\.filter\(item => item\?\.key !== 'admin'\)\)/)
    // Both render sites must consume the gated sidebarNav, not the raw
    // static SIDEBAR_NAV constant directly.
    expect(sidebarSource).toContain('{sidebarNav.filter(Boolean).map(item =>')
    expect(sidebarSource).toContain('{sidebarNav.map((item, i) =>')
    expect(sidebarSource).not.toMatch(/\{SIDEBAR_NAV\.(filter|map)/)
  })

  // Updated during the D.2.3 origin/main reconciliation merge: per the
  // task's own explicit instruction (app/dashboard/page.tsx section),
  // the generic /dashboard fallthrough now renders OrganisationDashboard
  // (Phase C.2C), not <BrainBase enabledCapabilities={...}
  // isSuperAdmin={...} /> — so BrainBase.jsx (and therefore LeftSidebar)
  // is no longer reachable from the normal, session-resolved generic
  // client path this test originally targeted. It IS still imported and
  // rendered, but only as app/dashboard/page.tsx's pre-session-resolution
  // auth-failure fallback (see organisationDashboardSeparation.test.ts),
  // where no session/role has been resolved at all yet — so there is
  // nothing to thread isSuperAdmin from at that point. The two checks
  // below replace the single prior one: (1) BrainBase.jsx's own
  // prop-threading into LeftSidebar remains structurally correct,
  // independent of who currently calls it, so it is ready to receive a
  // real isSuperAdmin value from any future caller; (2) the one call
  // site that still exists today never claims isSuperAdmin=true it
  // hasn't earned — it omits the prop entirely, which defaults to
  // false (fail-closed: Admin can never leak from a session-less
  // fallback render).
  it('BrainBase.jsx still correctly threads an isSuperAdmin prop through into LeftSidebar (component signature and prop-threading both structurally intact)', () => {
    expect(brainBaseSource).toContain('function BrainBase({ enabledCapabilities = [], isSuperAdmin = false })')
    expect(brainBaseSource).toContain('<LeftSidebar open={sidebarOpen} onToggle={toggleSidebar} isSuperAdmin={isSuperAdmin} />')
  })

  it('BrainBase.jsx is no longer the generic /dashboard fallthrough target — its only remaining render site (the pre-session-resolution auth-failure fallback) never passes isSuperAdmin, so it always defaults to false and Admin can never leak from that fallback', () => {
    expect(pageSource).toMatch(/<BrainBase enabledCapabilities=\{\[\]\} \/>/)
    expect(pageSource).not.toMatch(/<BrainBase[^>]*isSuperAdmin/)
  })
})

describe('Phase D.4.2 — capability icons across all three personas', () => {
  // Phase D.4.4E added Organiser as a third real capability-gated NavItem,
  // mirroring Events/CRM exactly in both branches — counts updated from
  // 2 to 3 accordingly; Phase C3 added Commercial as a fourth, gated on
  // 'quotes', same mirrored-in-both-branches pattern — counts updated
  // from 3 to 4; still no icon leaked onto a founder-only or
  // LD-Tennis-bespoke item.
  // HR-1 People Foundation added People as a fifth real capability-gated
  // NavItem, mirroring Events/CRM/Organiser/Commercial exactly in both
  // branches — counts updated from 4 to 5.
  // Nav consolidation update (feat/authenticated-nav-consolidation): the
  // per-branch `capability="..."` NavItem props are gone. Icons now come from
  // a descriptor's `icon` key and are rendered (CapabilityIcon
  // capability={link.icon}) only by MenuLink when `withIcon` is set, which
  // TopNav passes only for the Work entries (desktop Work menu + mobile Work
  // section). Same five-icon contract, now over the single shared tree.
  it('Persona 2/3 (generic + LD Tennis): only the Events, CRM, Commercial, Organiser, and People entries carry an icon — no icon leaked onto a founder-only or LD-Tennis-bespoke item', () => {
    const iconKeys = (navModelSource.match(/icon: '[a-zA-Z]+'/g) ?? [])
    expect(iconKeys).toEqual(["icon: 'events'", "icon: 'crm'", "icon: 'quotes'", "icon: 'organiser'", "icon: 'people'"])
    expect(topNavSource).not.toMatch(/capability="[a-zA-Z]+"/)
    expect((topNavSource.match(/<CapabilityIcon/g) ?? []).length).toBe(1)
    expect(topNavSource).toMatch(/\{withIcon && link\.icon && \(\s*\n\s*<CapabilityIcon\s*\n\s*capability=\{link\.icon\}/)
    // withIcons is passed only for nav.work (desktop menu + mobile section).
    const withIconsUses = topNavSource.match(/<MenuEntries[^>]*\/>/g) ?? []
    expect(withIconsUses.length).toBe(6) // work, manage, brainbase — desktop menus + mobile sections
    for (const use of withIconsUses) {
      if (use.includes('withIcons')) expect(use).toContain('entries={nav.work}')
      if (use.includes('entries={nav.work}')) expect(use).toContain('withIcons')
    }
    for (const variant of ['ld-tennis', null] as const) {
      for (const role of ['manager', 'super_admin']) {
        const withIcon = flattenNavLinks(resolveNav(ctx(role, ALL_CAPS, variant))).filter(l => l.icon)
        expect(withIcon.map(l => [l.id, l.icon]), `${role}/${variant}`).toEqual([
          ['events', 'events'], ['crm', 'crm'], ['commercial', 'quotes'], ['organiser', 'organiser'], ['people', 'people'],
        ])
      }
    }
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // "OPS_ITEMS' CRM entry does not render CapabilityIcon". APPROVED: the
  // Operations CRM duplicate is gone entirely; the Operations group has no
  // CRM and no icon, and the Brainbase menu is rendered without withIcons.
  it('Persona 1 (Founder/super_admin): the Operations group has no CRM entry and no icon, and the Brainbase menu renders its entries text-only (no withIcons)', () => {
    const ops = group(resolveNav(ctx('super_admin', ALL_CAPS, 'brainbase-hq')).brainbase, 'operations')!
    expect(ops.children.map(c => c.label)).not.toContain('CRM')
    for (const c of ops.children) expect(c.icon).toBeUndefined()
    expect(topNavSource).toMatch(/<MenuEntries entries=\{nav\.brainbase\} activeId=\{activeId\} onNavigate=\{close\} \/>/)
    expect(topNavSource).toMatch(/<MenuEntries entries=\{nav\.brainbase\} activeId=\{activeId\} onNavigate=\{onNavigate\} \/>/)
  })

  // Nav consolidation update (feat/authenticated-nav-consolidation): was
  // "no founder-only NavItem carries a capability prop"; now no Brainbase
  // descriptor carries an `icon` key (source) or resolves with one.
  it('Persona 1: no founder-only item (Founder OS, Clients, Client requests, Reports, Data, Command, Operations, Platform) carries an icon', () => {
    expect(brainbaseItemsSource).not.toMatch(/icon:/)
    const internal = flattenNavLinks(resolveNav(ctx('super_admin', ALL_CAPS, 'brainbase-hq'))).filter(l => INTERNAL_HREFS.includes(l.href))
    expect(internal.map(l => l.href).sort()).toEqual([...INTERNAL_HREFS].sort())
    for (const link of internal) expect(link.icon, link.href).toBeUndefined()
  })
})
