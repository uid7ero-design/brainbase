import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
// Nav consolidation update (feat/authenticated-nav-consolidation): "who sees
// what" moved out of TopNav's JSX into the pure components/nav/navModel.ts,
// so the pins below assert the descriptors (source + imported objects) and
// the resolved behaviour via resolveNav()/workModuleCards() — both pure and
// safe to import in a node test.
import {
  BRAINBASE_ITEMS,
  REQUESTS_LINK,
  WORK_ITEMS,
  resolveNav,
  workModuleCards,
  type NavContext,
  type NavEntry,
  type NavLink,
} from '@/components/nav/navModel'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness (same caveat as
// every other *StaticCheck.test.ts / containment test in this suite).
//
// Root cause this fixes: TopNav's isClientOrg branch rendered Leads,
// SquadItem (contacts), Sessions, and Blog unconditionally for EVERY
// non-super-admin client organisation. Those four items are LD Tennis's
// own coaching-business tools (tennis_leads, the "Program"/"Session Times"
// contact fields, the tennis session-type catalogue, and the
// /api/tennis/blog namespace) — not generic client tools. A generic client
// organisation (e.g. School Test Organisation) inherited them purely
// because isClientOrg's own definition (!isSuperAdmin &&
// enabledModules.length === 0) never distinguished between organisations
// at all. The fix reuses lib/dashboard/clientDashboard.ts's existing
// slug-driven dashboardVariantForSlug/resolveDashboardVariant — the SAME
// resolver app/dashboard/page.tsx already uses to pick TennisDashboard vs
// the generic BrainBase shell — rather than inventing a new capability.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const topNavSource = stripComments(read('components/nav/TopNav.tsx'))
const layoutSource = read('app/layout.tsx')
const apiMeSource = read('app/api/me/route.ts')
const resolverSource = read('lib/dashboard/clientDashboard.ts')
// Nav consolidation update (feat/authenticated-nav-consolidation): the
// visibility rules now live here, not in TopNav.
const navModelSource = stripComments(read('components/nav/navModel.ts'))

type Variant = NavContext['dashboardVariant']
const VARIANTS: Variant[] = [null, 'ld-tennis', 'brainbase-hq']
const ROLES = ['viewer', 'manager', 'admin', 'super_admin', 'analyst']

function flat(entries: readonly NavEntry[]): NavLink[] {
  return entries.flatMap(e => (e.kind === 'group' ? [...e.children] : [e]))
}
function workLinks(role: string, caps: string[], dashboardVariant: Variant): NavLink[] {
  return flat(resolveNav({ role, enabledCapabilities: caps, dashboardVariant }).work)
}
function workHrefs(role: string, caps: string[], dashboardVariant: Variant): string[] {
  return workLinks(role, caps, dashboardVariant).map(l => l.href)
}
function descriptor(id: string): NavLink {
  const found = flat(WORK_ITEMS).find(l => l.id === id)
  if (!found) throw new Error(`no Work descriptor ${id}`)
  return found
}
const TENNIS_HREFS = ['/dashboard/leads', '/dashboard/contacts', '/dashboard/sessions', '/dashboard/blog']

// Updated during the D.2.3 origin/main reconciliation merge: this whole
// describe block originally anchored on an `isClientOrg ? ( ... ) : ( ... )`
// ternary that no longer exists — C.2D's rewrite (already the architecture
// on this branch before the merge) replaced isClientOrg with dashboardVariant
// -driven isLdTennis/isBrainbaseHQ classification, and the ternary itself
// became `isLdTennis ? ( <LD Tennis's own bespoke nav> ) : ( <shared branch:
// generic clients AND Brainbase-internal staff together, each item
// individually gated within it> )`. Leads/Squad/Sessions/Blog are written
// directly inside the isLdTennis-true branch itself (not wrapped in a
// redundant `isLdTennis && (...)` gate inside a broader "client" branch,
// since the surrounding branch is already only reached when isLdTennis is
// true) — so the correct assertion is narrower and stronger than before:
// these items must appear ONLY inside that branch, and NOWHERE else in the
// file (not "gated", but branch-exclusive). The underlying protection this
// test exists for — a generic client organisation never receives LD
// Tennis's coaching-business tools — is unchanged and still verified below.
// Nav consolidation update (feat/authenticated-nav-consolidation): the
// `isLdTennis ? ( ... ) : ( ... )` two-branch JSX is gone — TopNav now has ONE
// universal render path over resolveNav(). LD Tennis's coaching tools live in
// a single Tennis Work group gated { variant: 'ld-tennis' } in navModel.ts.
// The protection is unchanged and asserted more strongly (source + behaviour
// across every role/variant): a generic or HQ organisation never receives
// Leads/Squad/Sessions/Blog, and each is declared exactly once.
describe('TopNav — LD-Tennis-specific nav items are gated on dashboardVariant, not shown to every client org', () => {
  it('Leads, Squad (Contacts), and Sessions are rendered inside the isLdTennis-true branch', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // "isLdTennis branch" is now the Tennis group, gated on the ld-tennis variant.
    const tennis = WORK_ITEMS.find(e => e.id === 'tennis')
    expect(tennis?.kind).toBe('group')
    expect(tennis?.gate).toEqual({ variant: 'ld-tennis' })
    const children = tennis?.kind === 'group' ? tennis.children : []
    expect(children.map(c => [c.label, c.href])).toEqual([
      ['Leads', '/dashboard/leads'],
      ['Squad', '/dashboard/contacts'],
      ['Sessions', '/dashboard/sessions'],
      ['Blog', '/dashboard/blog'],
    ])
    expect(workHrefs('viewer', [], 'ld-tennis')).toEqual(TENNIS_HREFS)
    expect(navModelSource).toMatch(/id: 'tennis', label: 'Tennis',\s*gate: \{ variant: 'ld-tennis' \},/)
    for (const role of ROLES.filter(r => r !== 'analyst')) {
      const hrefs = workHrefs(role, [], 'ld-tennis')
      expect(hrefs, role).toContain('/dashboard/leads')
      expect(hrefs, role).toContain('/dashboard/contacts')
      expect(hrefs, role).toContain('/dashboard/sessions')
    }
  })

  it('Leads/Squad/Sessions never appear in the shared (generic-client + internal-staff) branch at all', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): "shared
    // branch" = every organisation that is not ld-tennis (generic + HQ), for
    // every role and every capability set.
    for (const v of [null, 'brainbase-hq'] as const) {
      for (const role of ROLES) {
        const all = resolveNav({ role, enabledCapabilities: ['events', 'crm', 'quotes', 'organiser', 'people'], dashboardVariant: v })
        const hrefs = [...flat(all.work), ...flat(all.manage), ...flat(all.brainbase)].map(l => l.href)
        expect(hrefs, `${role}/${v}`).not.toContain('/dashboard/leads')
        expect(hrefs, `${role}/${v}`).not.toContain('/dashboard/contacts')
        expect(hrefs, `${role}/${v}`).not.toContain('/dashboard/sessions')
      }
    }
    // Exactly one declaration of each across the whole model, and none
    // hardcoded in TopNav (it only renders the resolved tree).
    expect((navModelSource.match(/href: '\/dashboard\/leads'/g) ?? []).length).toBe(1)
    expect((navModelSource.match(/href: '\/dashboard\/contacts'/g) ?? []).length).toBe(1)
    expect((navModelSource.match(/href: '\/dashboard\/sessions'/g) ?? []).length).toBe(1)
    for (const href of ['/dashboard/leads', '/dashboard/contacts', '/dashboard/sessions']) {
      expect(topNavSource).not.toContain(href)
    }
    expect(topNavSource).not.toMatch(/<SquadItem/)
  })

  it('Blog is also isLdTennis-exclusive (the /api/tennis/blog namespace is LD Tennis-specific, not a generic client tool)', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): Blog is
    // a Tennis-group child; asserted via the model instead of the JSX branch.
    expect(workHrefs('viewer', [], 'ld-tennis')).toContain('/dashboard/blog')
    for (const v of [null, 'brainbase-hq'] as const) {
      for (const role of ROLES) {
        expect(workHrefs(role, ['events', 'crm'], v), `${role}/${v}`).not.toContain('/dashboard/blog')
      }
    }
    expect((navModelSource.match(/href: '\/dashboard\/blog'/g) ?? []).length).toBe(1)
    expect(topNavSource).not.toContain('/dashboard/blog')
  })

  it('Requests (client_pipeline — a platform-global feedback/issue channel to BrainBase, not tennis-specific) is present in BOTH branches: unconditionally for LD Tennis, and !isBrainbaseHQ-gated for the shared branch (visible to generic clients, hidden from Brainbase HQ staff)', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // `{!isBrainbaseHQ && (` JSX gate is now REQUESTS_LINK's
    // { hideForVariant: 'brainbase-hq' }; TopNav renders it via `nav.requests &&`.
    expect(REQUESTS_LINK.href).toBe('/dashboard/pipeline')
    expect(REQUESTS_LINK.gate).toEqual({ hideForVariant: 'brainbase-hq' })
    expect(navModelSource).toMatch(/gate: \{ hideForVariant: 'brainbase-hq' \}/)
    for (const role of ROLES) {
      expect(resolveNav({ role, enabledCapabilities: [], dashboardVariant: 'ld-tennis' }).requests?.href, role).toBe('/dashboard/pipeline')
      expect(resolveNav({ role, enabledCapabilities: [], dashboardVariant: null }).requests?.href, role).toBe('/dashboard/pipeline')
      expect(resolveNav({ role, enabledCapabilities: [], dashboardVariant: 'brainbase-hq' }).requests, role).toBeNull()
    }
    expect(topNavSource).toMatch(/\{nav\.requests && \(/)
  })

  it('Events remains gated purely by enabledCapabilities, never by isLdTennis or dashboardVariant', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // gate is the descriptor's own; it must carry NO variant predicate.
    expect(descriptor('events').gate).toEqual({ anyCapability: ['events'] })
    expect(navModelSource).toMatch(/label: 'Events & Ticketing', href: '\/events'[\s\S]{0,200}?gate: \{ anyCapability: \['events'\] \},/)
    for (const v of VARIANTS) {
      for (const role of ROLES) {
        expect(workHrefs(role, ['events'], v), `${role}/${v}`).toContain('/events')
        expect(workHrefs(role, [], v), `${role}/${v}`).not.toContain('/events')
      }
    }
  })
})

describe('dashboardVariant plumbing — reused existing resolver, no hardcoded organisation, no new capability invented', () => {
  it('TopNav derives isLdTennis from a dashboardVariant session field, not a hardcoded organisation id/slug', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): TopNav
    // no longer derives isLdTennis/isBrainbaseHQ at all — it hands the
    // session's dashboardVariant straight to resolveNav(), and the model's
    // variant gate compares against it. No tenant branching in TopNav.
    expect(topNavSource).toMatch(/const nav = resolveNav\(\{ role, enabledCapabilities, dashboardVariant \}\);/)
    expect(topNavSource).not.toMatch(/isLdTennis|isBrainbaseHQ/)
    expect(topNavSource).not.toMatch(/dashboardVariant\s*===/)
    expect(navModelSource).toMatch(/if \(gate\.variant && ctx\.dashboardVariant !== gate\.variant\) return false;/)
    expect(topNavSource).not.toMatch(/school-test-organisation/i)
    expect(topNavSource).not.toMatch(/organisationId\s*===\s*['"]/)
    expect(navModelSource).not.toMatch(/school-test-organisation/i)
    expect(navModelSource).not.toMatch(/organisationId/)
  })

  it('app/layout.tsx computes dashboardVariant via the EXISTING lib/dashboard/clientDashboard.ts resolver — not a new capability or a duplicated slug map', () => {
    expect(layoutSource).toContain("import { resolveDashboardVariant } from '@/lib/dashboard/clientDashboard'")
    expect(layoutSource).toMatch(/dashboardVariant = await resolveDashboardVariant\(session\.organisationId, session\.role\)/)
    expect(layoutSource).not.toContain("'ld-tennis':")
  })

  it('app/api/me/route.ts (TopNav\'s client-fetch fallback path) also uses the SAME resolver, for parity with the server-rendered path', () => {
    expect(apiMeSource).toContain("import { resolveDashboardVariant } from '@/lib/dashboard/clientDashboard'")
    expect(apiMeSource).toMatch(/resolveDashboardVariant\(session\.organisationId, session\.role\)/)
  })

  it('the resolver itself remains slug-driven and organisation-agnostic — School Test Organisation is never named anywhere in this chain', () => {
    expect(resolverSource).not.toMatch(/school-test-organisation/i)
    expect(topNavSource).not.toMatch(/school-test-organisation/i)
    expect(layoutSource).not.toMatch(/school-test-organisation/i)
    expect(apiMeSource).not.toMatch(/school-test-organisation/i)
    // Nav consolidation update (feat/authenticated-nav-consolidation): the nav
    // model is now part of this chain too.
    expect(navModelSource).not.toMatch(/school-test-organisation/i)
  })

  it('LD Tennis is only ever referenced via its slug in the resolver\'s existing CLIENT_DASHBOARD_SLUGS map — the one, already-established place organisation identity is hardcoded for dashboard-variant purposes', () => {
    expect(resolverSource).toMatch(/'ld-tennis':\s*'ld-tennis'/)
  })
})

describe('Tenant isolation is unaffected — this change is UI-visibility only, no query/authorization logic touched', () => {
  it('TopNav.tsx contains no SQL/database access at all (nav visibility is a pure prop-driven render, never a data-scoping boundary)', () => {
    expect(topNavSource).not.toMatch(/from\s+['"]@\/lib\/db['"]/)
    expect(topNavSource).not.toMatch(/\bsql`/)
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // visibility model TopNav now renders is equally pure.
    expect(navModelSource).not.toMatch(/from\s+['"]@\/lib\/db['"]/)
    expect(navModelSource).not.toMatch(/\bsql`/)
  })

  it('the underlying data routes each nav item points to remain unmodified by this pass — /api/events, /dashboard/leads, /dashboard/contacts, /dashboard/sessions all still scope by session.organisationId, not by anything nav-visibility-related', () => {
    const leadsPage = read('app/dashboard/leads/page.tsx')
    const contactsPage = read('app/dashboard/contacts/page.tsx')
    const sessionsPage = read('app/dashboard/sessions/page.tsx')
    expect(leadsPage).toMatch(/organisation_id = \$\{session\.organisationId\}/)
    expect(contactsPage).toMatch(/organisation_id = \$\{session\.organisationId\}/)
    // sessions/page.tsx is a client component fetching its own
    // API-scoped data — asserting only that this pass did not touch it.
    expect(sessionsPage.length).toBeGreaterThan(0)
  })
})

// Phase 6.2 §10 — CRM was previously only reachable via OpsDropdown,
// itself gated on isBrainbaseHQ (Brainbase's own staff only) — so a
// client organisation with the crm capability enabled had no nav path
// to CRM at all. The fix adds a standalone, capability-gated NavItem to
// both the shared (generic client + Brainbase HQ staff) branch and the
// isLdTennis branch, mirroring hasEvents/Events exactly. OpsDropdown's
// own internal CRM shortcut is untouched — these are two independent
// entries serving two different audiences, not a replacement.
//
// Nav consolidation update (feat/authenticated-nav-consolidation): both
// "branches" collapse into one CRM descriptor in navModel WORK_ITEMS, and the
// Operations CRM duplicate is retired (APPROVED: CRM lives in Work only). The
// reachability contract — any organisation with crm enabled, of any variant,
// gets a /crm entry; nobody without it does — is asserted behaviourally.
describe('TopNav — CRM nav item is capability-driven, reachable by any client organisation with crm enabled', () => {
  it('hasCrm is derived from enabledCapabilities, not hardcoded to any organisation', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // hasCrm flag is now the descriptor gate { anyCapability: ['crm'] }.
    expect(descriptor('crm').gate).toEqual({ anyCapability: ['crm'] })
    expect(navModelSource).toMatch(/label: 'CRM', href: '\/crm'[\s\S]{0,200}?gate: \{ anyCapability: \['crm'\] \},/)
    expect(navModelSource).toMatch(/const enabled = gate\.anyCapability\.some\(key => ctx\.enabledCapabilities\.includes\(key\)\);/)
  })

  it('a top-level CRM NavItem, gated on hasCrm, is present in the shared branch (generic clients + Brainbase HQ staff)', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): shared
    // branch = null + brainbase-hq variants; CRM is never tied to HQ status.
    for (const v of [null, 'brainbase-hq'] as const) {
      for (const role of ROLES) {
        expect(workHrefs(role, ['crm'], v), `${role}/${v}`).toContain('/crm')
        expect(workHrefs(role, [], v), `${role}/${v}`).not.toContain('/crm')
      }
    }
  })

  it('a top-level CRM NavItem, gated on hasCrm, is also present in the isLdTennis branch (parity with Events)', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): parity
    // is now structural (one tree); asserted for the ld-tennis variant.
    for (const role of ROLES) {
      expect(workHrefs(role, ['crm'], 'ld-tennis'), role).toContain('/crm')
      expect(workHrefs(role, [], 'ld-tennis'), role).not.toContain('/crm')
    }
  })

  it('the standalone CRM NavItem points at /crm, exactly matching the ModuleAccessCard dashboard card\'s own href', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation):
    // ModuleAccessCard no longer declares its own href literal — it derives
    // its rows from the SAME descriptor via workModuleCards(), so the hrefs
    // match by construction.
    const moduleAccessCard = read('components/dashboard/ModuleAccessCard.tsx')
    expect(descriptor('crm').href).toBe('/crm')
    expect(moduleAccessCard).toMatch(/import \{ workModuleCards, type DashboardVariant \} from '@\/components\/nav\/navModel'/)
    expect(moduleAccessCard).toMatch(/href: link\.href,/)
    const card = workModuleCards({ role: 'viewer', enabledCapabilities: ['crm'], dashboardVariant: null })
    expect(card.map(l => [l.id, l.href])).toEqual([['crm', '/crm']])
  })

  it('OpsDropdown\'s own internal CRM shortcut (Brainbase HQ staff only) is untouched — still exactly one OPS_ITEMS entry, still gated on isBrainbaseHQ, not removed or duplicated by this fix', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation):
    // APPROVED change — OpsDropdown/OPS_ITEMS are replaced by the internal
    // Brainbase menu, and its Operations CRM duplicate is gone. New pin: CRM
    // is declared exactly once (Work), never inside BRAINBASE_ITEMS, and
    // TopNav carries no CRM literal or OpsDropdown of its own.
    expect((navModelSource.match(/label: 'CRM',/g) ?? []).length).toBe(1)
    expect((navModelSource.match(/href: '\/crm'/g) ?? []).length).toBe(1)
    expect(flat(BRAINBASE_ITEMS).some(l => l.href === '/crm' || l.label === 'CRM')).toBe(false)
    expect(topNavSource).not.toMatch(/<OpsDropdown|OPS_ITEMS/)
    expect(topNavSource).not.toMatch(/label[=:]\s*['"]CRM['"]/)
  })

  it('the new CRM NavItems appear exactly twice total (shared branch + isLdTennis branch) — no accidental third copy', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): one
    // descriptor now serves every organisation (desktop Work menu and mobile
    // menu both render the same resolved tree), so the count is exactly one,
    // and a resolved tree never contains CRM twice.
    expect(flat(WORK_ITEMS).filter(l => l.label === 'CRM').length).toBe(1)
    for (const v of VARIANTS) {
      const nav = resolveNav({ role: 'super_admin', enabledCapabilities: ['crm'], dashboardVariant: v })
      const all = [...flat(nav.work), ...flat(nav.manage), ...flat(nav.brainbase)]
      expect(all.filter(l => l.href === '/crm').length, String(v)).toBe(1)
    }
  })
})

// Phase D.4.2 — the top-level Events/CRM NavItems (both branches) now carry
// a capability icon. Cross-checks that TopNav's icon identity matches
// ModuleAccessCard's own mapping exactly — Events must never read as Ticket
// in one surface and Calendar in the other, same for CRM's colour/glyph.
//
// Nav consolidation update (feat/authenticated-nav-consolidation): the icon
// key is now the descriptor's `icon`, and BOTH surfaces read that same field
// (TopNav MenuLink → CapabilityIcon capability={link.icon}; ModuleAccessCard
// → icon: link.icon ?? link.id). Identity is shared by construction.
describe('TopNav — CRM/Events capability icons match ModuleAccessCard\'s identity exactly (same capability id, same shared CapabilityIcon component)', () => {
  const moduleAccessCard = read('components/dashboard/ModuleAccessCard.tsx')
  const capabilityIcon = read('components/brand/CapabilityIcon.tsx')

  it('both surfaces import the SAME CapabilityIcon component — no second icon mapping was created for TopNav', () => {
    expect(topNavSource).toContain("import { CapabilityIcon } from '@/components/brand/CapabilityIcon'")
    expect(moduleAccessCard).toContain("import { CapabilityIcon } from '@/components/brand/CapabilityIcon'")
  })

  it('both surfaces take the icon key from the SAME navModel descriptor field', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): new
    // shared-source pin replacing the per-branch capability="…" literals.
    expect(topNavSource).toMatch(/<CapabilityIcon\s+capability=\{link\.icon\}/)
    expect(moduleAccessCard).toMatch(/icon: link\.icon \?\? link\.id,/)
    expect(moduleAccessCard).toMatch(/<CapabilityIcon capability=\{entry\.icon\}/)
  })

  it('the Events NavItem (both branches) is passed capability="events" — the same id CapabilityIcon.tsx maps to Ticket/amber for ModuleAccessCard', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation).
    expect(descriptor('events').label).toBe('Events & Ticketing')
    expect(descriptor('events').icon).toBe('events')
    expect(navModelSource).toMatch(/label: 'Events & Ticketing', href: '\/events', match: \['\/events'\],\s*icon: 'events',/)
    expect(capabilityIcon).toMatch(/events:\s*{\s*Icon:\s*Ticket,\s*color:\s*'#FBBF24'/)
  })

  it('the CRM NavItem (both branches) is passed capability="crm" — the same id CapabilityIcon.tsx maps to Users/violet for ModuleAccessCard', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation).
    expect(descriptor('crm').icon).toBe('crm')
    expect(navModelSource).toMatch(/label: 'CRM', href: '\/crm', match: \['\/crm'\],\s*icon: 'crm',/)
    expect(capabilityIcon).toMatch(/crm:\s*{\s*Icon:\s*Users,\s*color:\s*'#8A4DFF'/)
  })

  it('the Organiser NavItem (both branches) is passed capability="organiser" — the same id CapabilityIcon.tsx maps to CalendarClock/cyan for ModuleAccessCard', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation).
    expect(descriptor('organiser').icon).toBe('organiser')
    expect(navModelSource).toMatch(/label: 'Organiser', href: '\/organiser', match: \['\/organiser'\],\s*icon: 'organiser',/)
    expect(capabilityIcon).toMatch(/organiser:\s*{\s*Icon:\s*CalendarClock,\s*color:\s*'#38BDF8'/)
  })
})

// Phase D.4.4E — Organiser promoted to a first-class TopNav item, mirroring
// the CRM fix above (Phase 6.2 §10) exactly: previously Organiser only
// existed as a nav item nested inside the generic ops Sidebar (part of the
// WorkspaceShell chrome /command and /organiser both used to share) — that
// coupling is now gone entirely (see opsSidebarOrganiserRemoval.test.ts).
// This adds a standalone, capability-gated NavItem to both the shared
// (generic client + Brainbase HQ staff) branch and the isLdTennis branch.
//
// Nav consolidation update (feat/authenticated-nav-consolidation): one
// Organiser descriptor in WORK_ITEMS. APPROVED change: the gate is now the
// capability AND manager+, mirroring app/organiser/layout.tsx, so the chrome
// never offers a link the route rejects.
describe('TopNav — Organiser nav item is capability-driven, reachable by any client organisation with organiser enabled', () => {
  it('hasOrganiser is derived from enabledCapabilities, not hardcoded to any organisation', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation).
    expect(descriptor('organiser').gate).toEqual({ anyCapability: ['organiser'], minRole: 'manager' })
    expect(navModelSource).toMatch(/gate: \{ anyCapability: \['organiser'\], minRole: 'manager' \},/)
  })

  it('a top-level Organiser NavItem, gated on hasOrganiser, is present in the shared branch (generic clients + Brainbase HQ staff)', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation).
    for (const v of [null, 'brainbase-hq'] as const) {
      for (const role of ['manager', 'admin', 'super_admin']) {
        expect(workHrefs(role, ['organiser'], v), `${role}/${v}`).toContain('/organiser')
        expect(workHrefs(role, [], v), `${role}/${v}`).not.toContain('/organiser')
      }
    }
  })

  it('a top-level Organiser NavItem, gated on hasOrganiser, is also present in the isLdTennis branch (parity with Events/CRM)', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation).
    for (const role of ['manager', 'admin', 'super_admin']) {
      expect(workHrefs(role, ['organiser'], 'ld-tennis'), role).toContain('/organiser')
      expect(workHrefs(role, [], 'ld-tennis'), role).not.toContain('/organiser')
    }
  })

  it('the standalone Organiser NavItem points at /organiser — the same canonical route app/organiser/page.tsx serves', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation).
    expect(descriptor('organiser').href).toBe('/organiser')
    expect(navModelSource).toMatch(/href: '\/organiser'/)
  })

  it('Organiser is not gated on isBrainbaseHQ, isLdTennis, super_admin, or role — entitlement is the only condition, in both branches', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation):
    // APPROVED change — role IS now a condition (manager+, matching the
    // route). Still never tenant/variant/HQ/super_admin-gated: the gate has
    // exactly two keys, no variant/hideForVariant/internal/bypass, and
    // super_admin gets no bypass without the capability.
    const gate = descriptor('organiser').gate ?? {}
    expect(Object.keys(gate).sort()).toEqual(['anyCapability', 'minRole'])
    for (const v of VARIANTS) {
      expect(workHrefs('super_admin', [], v), String(v)).not.toContain('/organiser')
      expect(workHrefs('viewer', ['organiser'], v), String(v)).not.toContain('/organiser')
      expect(workHrefs('analyst', ['organiser'], v), String(v)).not.toContain('/organiser')
      expect(workHrefs('manager', ['organiser'], v), String(v)).toContain('/organiser')
    }
  })

  it('the new Organiser NavItems appear exactly twice total (shared branch + isLdTennis branch) — no accidental third copy, no new dropdown', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): one
    // descriptor, zero TopNav literals, and TopNav's menus stay exactly
    // Work / Manage / Brainbase / Account (no Organiser-specific dropdown).
    expect((navModelSource.match(/label: 'Organiser'/g) ?? []).length).toBe(1)
    expect(topNavSource).not.toMatch(/label[=:]\s*['"]Organiser['"]/)
    expect((topNavSource.match(/<NavMenu\b/g) ?? []).length).toBe(4)
    expect(topNavSource).toMatch(/<NavMenu label="Work"/)
    expect(topNavSource).toMatch(/<NavMenu label="Manage"/)
    expect(topNavSource).toMatch(/<NavMenu label="Brainbase"/)
    expect(topNavSource).toMatch(/panelLabel="Account"/)
  })
})
