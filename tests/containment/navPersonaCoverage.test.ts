import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

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

const topNavSource = stripComments(read('components/nav/TopNav.tsx'))

const ldTennisBranchStart = topNavSource.indexOf('isLdTennis ? (')
const ldTennisBranchEnd = topNavSource.indexOf(') : (', ldTennisBranchStart)
const ldTennisRegion = topNavSource.slice(ldTennisBranchStart, ldTennisBranchEnd)
// The shared branch: rendered for every session that is not LD Tennis —
// generic clients AND Brainbase HQ staff together, distinguished only by
// per-item gates within it.
const sharedRegion = topNavSource.slice(ldTennisBranchEnd, topNavSource.indexOf('width: 185,', ldTennisBranchEnd))

describe('Persona 1 — Founder / super_admin: Operations and Admin dropdowns are populated, independent of enabledModules', () => {
  it('OpsDropdown is rendered for isBrainbaseHQ (narrower than the old isManager check — implies super_admin at the Brainbase org specifically) — only in the shared branch, never in the LD Tennis branch', () => {
    expect(sharedRegion).toMatch(/\{isBrainbaseHQ && \(\s*\n\s*<OpsDropdown/)
    expect(ldTennisRegion).not.toContain('OpsDropdown')
  })

  it('AdminDropdown is rendered for isSuperAdmin — only in the shared branch, never in the LD Tennis branch', () => {
    expect(sharedRegion).toMatch(/\{isSuperAdmin && \(\s*\n\s*<AdminDropdown/)
    expect(ldTennisRegion).not.toContain('AdminDropdown')
  })

  it('OPS_ITEMS contains the expected founder Operations entries — Waste, Fleet, Social (unconditional) and CRM (capability-gated)', () => {
    const start = topNavSource.indexOf('const OPS_ITEMS')
    const opsBody = topNavSource.slice(start, topNavSource.indexOf('\n];', start))
    for (const label of ['Waste', 'Fleet', 'Social', 'CRM']) {
      expect(opsBody).toMatch(new RegExp(`label:\\s*'${label}'`))
    }
  })

  it('ADMIN_ITEMS contains the expected founder Admin entries — Organisations, Users, Client Events, Pipeline, Setup', () => {
    const start = topNavSource.indexOf('const ADMIN_ITEMS')
    const adminBody = topNavSource.slice(start, topNavSource.indexOf('\n];', start))
    for (const label of ['Organisations', 'Users', 'Client Events', 'Pipeline', 'Setup']) {
      expect(adminBody).toMatch(new RegExp(`label:\\s*'${label}'`))
    }
  })

  it('ADMIN_ITEMS is rendered unconditionally — no .filter(...) call sits between the array and its render map, so no capability/module gate can ever empty it', () => {
    const renderIdx = topNavSource.indexOf('{ADMIN_ITEMS.map(item =>')
    expect(renderIdx).toBeGreaterThan(-1)
    const declIdx = topNavSource.indexOf('const ADMIN_ITEMS')
    const between = topNavSource.slice(declIdx, renderIdx)
    expect(between).not.toMatch(/ADMIN_ITEMS\s*=\s*ADMIN_ITEMS\.filter/)
  })

  it('OPS_ITEMS filtering is keyed on enabledCapabilities only — enabledModules is never referenced anywhere in the OpsDropdown/AdminDropdown definitions', () => {
    const opsDropdownStart = topNavSource.indexOf('function OpsDropdown')
    const opsDropdownEnd = topNavSource.indexOf('function AdminDropdown')
    const dropdownsSource = topNavSource.slice(opsDropdownStart, topNavSource.indexOf('function Logo', opsDropdownEnd))
    expect(dropdownsSource).not.toMatch(/enabledModules/)
  })

  it('isBrainbaseHQ and isLdTennis are mutually-exclusive derivations of the SAME single dashboardVariant field (DashboardVariant = \'ld-tennis\' | \'brainbase-hq\' | null — see lib/dashboard/clientDashboard.ts), so a founder/super_admin session can never simultaneously satisfy both, or fall into the LD Tennis branch while also being Brainbase HQ; and per that resolver\'s own role gate (dashboardVariantForSlug: \'brainbase-hq\' requires role === \'super_admin\', asserted directly in clientDashboardResolver.test.ts), isBrainbaseHQ can only ever be true for an actual super_admin session — never merely because enabledModules/enabledCapabilities happened to be non-empty (defensive: enabledModules is currently always empty due to a separate, pre-existing organisation_modules.module_id/modules.id schema mismatch bug)', () => {
    expect(topNavSource).toMatch(/const isLdTennis =\s*dashboardVariant === 'ld-tennis';/)
    expect(topNavSource).toMatch(/const isBrainbaseHQ =\s*dashboardVariant === 'brainbase-hq';/)
  })

  it('Founder-only pills (Founder OS, Clients) are gated on isSuperAdmin, never on enabledModules, and only ever appear in the shared branch, never the LD Tennis branch', () => {
    expect(sharedRegion).toMatch(/\{isSuperAdmin && \(\s*\n\s*<NavItem\s*\n\s*href="\/admin\/founder"/)
    expect(sharedRegion).toMatch(/\{isSuperAdmin && \(\s*\n\s*<NavItem\s*\n\s*href="\/clients"/)
    expect(ldTennisRegion).not.toMatch(/href="\/admin\/founder"|href="\/clients"/)
  })
})

describe('Persona 2 — generic client manager (e.g. School Test Organisation): no founder items leak in', () => {
  it('every founder-only surface (OpsDropdown, AdminDropdown, Founder OS, Clients, Reports, Data, Command) that appears in the shared branch is individually gated behind isBrainbaseHQ or isSuperAdmin — both false for a generic client — rather than being physically confined to a separate region (there is no separate region any more; a generic client and Brainbase HQ staff share this exact branch)', () => {
    for (const marker of ['<OpsDropdown', '<AdminDropdown']) {
      const idx = sharedRegion.indexOf(marker)
      expect(idx, `${marker} not found in the shared branch`).toBeGreaterThan(-1)
      const preceding = sharedRegion.slice(Math.max(0, idx - 60), idx)
      expect(preceding, `${marker} must be immediately preceded by an isBrainbaseHQ/isSuperAdmin gate`).toMatch(/\{is(BrainbaseHQ|SuperAdmin) && \(/)
    }
    for (const href of ['/admin/founder', '/clients', '/reports', '/data', '/command']) {
      const idx = sharedRegion.indexOf(`href="${href}"`)
      expect(idx, `href="${href}" not found in the shared branch`).toBeGreaterThan(-1)
      const gateIdx = sharedRegion.lastIndexOf('{is', idx)
      expect(gateIdx, `href="${href}" not preceded by an is*-gate`).toBeGreaterThan(-1)
      expect(sharedRegion.slice(gateIdx, idx)).toMatch(/\{is(BrainbaseHQ|SuperAdmin) && \(/)
    }
  })

  it('Events remains visible when enabledCapabilities includes it (via hasEvents), and Requests remains visible unconditional on isLdTennis (gated only on !isBrainbaseHQ) — the two items a generic client IS meant to see in the shared branch', () => {
    expect(sharedRegion).toMatch(/\{hasEvents && \(/)
    expect(sharedRegion).toMatch(/href="\/dashboard\/pipeline"[\s\S]{0,80}label="Requests"/)
    const requestsIdx = sharedRegion.indexOf('href="/dashboard/pipeline"')
    expect(sharedRegion.lastIndexOf('{!isBrainbaseHQ && (', requestsIdx)).toBeGreaterThan(-1)
  })

  it('Squad, Sessions, Leads, and Blog do not exist anywhere in the shared branch — a generic client organisation never sees them, because these items are written only inside the isLdTennis-true branch (proven exhaustively in clientNavOwnership.test.ts; re-asserted here as part of full persona coverage)', () => {
    expect(sharedRegion).not.toMatch(/href="\/dashboard\/leads"/)
    expect(sharedRegion).not.toContain('<SquadItem')
    expect(sharedRegion).not.toMatch(/href="\/dashboard\/sessions"/)
    expect(sharedRegion).not.toMatch(/href="\/dashboard\/blog"/)
  })
})

describe('Persona 3 — LD Tennis manager: full tennis navigation retained, founder tools never leak in', () => {
  it('LD Tennis takes the isLdTennis-true branch, which structurally never references OpsDropdown/AdminDropdown at all — regardless of the LD Tennis user\'s own role (manager or super_admin), since dashboardVariant is a single value and \'ld-tennis\'/\'brainbase-hq\' are mutually exclusive, an LD-Tennis-org session can never also be isBrainbaseHQ, and the founder-tool gates live only in the OTHER (shared) branch this session never reaches', () => {
    expect(topNavSource).toMatch(/const isLdTennis =\s*dashboardVariant === 'ld-tennis';/)
    expect(ldTennisRegion).not.toContain('OpsDropdown')
    expect(ldTennisRegion).not.toContain('AdminDropdown')
  })

  it('Leads, Squad, Sessions, Blog, Requests, and Events are all reachable for isLdTennis (proven functionally in clientNavOwnership.test.ts; asserted here as part of full persona coverage)', () => {
    expect(ldTennisRegion).toMatch(/isLdTennis && \(/)
    expect(ldTennisRegion).toContain('href="/dashboard/leads"')
    expect(ldTennisRegion).toContain('<SquadItem')
    expect(ldTennisRegion).toContain('href="/dashboard/sessions"')
    expect(ldTennisRegion).toContain('href="/dashboard/blog"')
    expect(ldTennisRegion).toContain('href="/dashboard/pipeline"')
    expect(ldTennisRegion).toMatch(/enabledCapabilities\.includes\(\s*\n?\s*'events',?\s*\n?\s*\)/)
  })

  it('no founder Admin tool (AdminDropdown, /admin/founder, /clients) is reachable from LD Tennis\'s branch', () => {
    expect(ldTennisRegion).not.toContain('AdminDropdown')
    expect(ldTennisRegion).not.toMatch(/href="\/admin\/founder"|href="\/clients"/)
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
  it('Persona 2/3 (shared branch + LD Tennis branch): only Events and CRM NavItem entries carry a capability prop, using this file\'s own already-computed regions — no icon leaked onto a founder-only or LD-Tennis-bespoke item', () => {
    const sharedCapabilityProps = sharedRegion.match(/capability="[a-zA-Z]+"/g) ?? []
    const ldTennisCapabilityProps = ldTennisRegion.match(/capability="[a-zA-Z]+"/g) ?? []
    expect(sharedCapabilityProps.length).toBe(2) // Events & Ticketing, CRM
    expect(ldTennisCapabilityProps.length).toBe(2) // Events, CRM
    for (const prop of [...sharedCapabilityProps, ...ldTennisCapabilityProps]) {
      expect(prop === 'capability="events"' || prop === 'capability="crm"').toBe(true)
    }
  })

  it('Persona 1 (Founder/super_admin): OPS_ITEMS\' own CRM entry (the Operations-dropdown internal shortcut) does NOT render CapabilityIcon — audited and deliberately left as a text-only dropdown row, a different pattern from the top-level pill', () => {
    const start = topNavSource.indexOf('const OPS_ITEMS')
    const opsBody = topNavSource.slice(start, topNavSource.indexOf('\n];', start))
    expect(opsBody).toMatch(/label:\s*'CRM'/)
    expect(opsBody).not.toMatch(/CapabilityIcon/)
  })

  it('Persona 1: no founder-only item (Founder OS, Clients, Reports, Data, Command, OpsDropdown, AdminDropdown) carries a capability prop', () => {
    for (const href of ['/admin/founder', '/clients', '/reports', '/data', '/command']) {
      const idx = sharedRegion.indexOf(`href="${href}"`)
      expect(idx).toBeGreaterThan(-1)
      const blockEnd = sharedRegion.indexOf('/>', idx)
      const block = sharedRegion.slice(idx, blockEnd)
      expect(block).not.toMatch(/capability=/)
    }
  })
})
