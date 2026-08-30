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

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const topNavSource = stripComments(read('components/nav/TopNav.tsx'))

const clientBranchStart = topNavSource.indexOf('isClientOrg ? (')
const clientBranchEnd = topNavSource.indexOf(') : (', clientBranchStart)
const clientRegion = topNavSource.slice(clientBranchStart, clientBranchEnd)
const staffRegion = topNavSource.slice(clientBranchEnd, topNavSource.indexOf('width: 185,', clientBranchEnd))

describe('Persona 1 — Founder / super_admin: Operations and Admin dropdowns are populated, independent of enabledModules', () => {
  it('OpsDropdown is rendered for isManager (true for super_admin) — only in the non-client (staff) branch', () => {
    expect(staffRegion).toMatch(/\{isManager && \(\s*\n\s*<OpsDropdown/)
    // Never referenced inside the client-org branch — a client-org
    // session (including a manager-role client, e.g. LD Tennis) must
    // never reach OpsDropdown at all.
    expect(clientRegion).not.toContain('OpsDropdown')
  })

  it('AdminDropdown is rendered for isSuperAdmin — only in the non-client (staff) branch', () => {
    expect(staffRegion).toMatch(/\{isSuperAdmin && \(\s*\n\s*<AdminDropdown/)
    expect(clientRegion).not.toContain('AdminDropdown')
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

  it("isSuperAdmin forces isClientOrg to false regardless of enabledModules — a founder session can never fall into the client-org branch even if enabledModules happened to be non-empty (defensive: enabledModules is currently always empty due to a separate, pre-existing organisation_modules.module_id/modules.id schema mismatch bug)", () => {
    expect(topNavSource).toMatch(/const isClientOrg =\s*\n\s*!isSuperAdmin &&\s*\n\s*enabledModules\.length === 0;/)
  })

  it('Founder-only pills (Founder OS, Clients) are gated on isSuperAdmin, never on enabledModules, and only ever appear in the staff branch', () => {
    expect(staffRegion).toMatch(/\{isSuperAdmin && \(\s*\n\s*<NavItem\s*\n\s*href="\/admin\/founder"/)
    expect(staffRegion).toMatch(/\{isSuperAdmin && \(\s*\n\s*<NavItem\s*\n\s*href="\/clients"/)
    expect(clientRegion).not.toMatch(/href="\/admin\/founder"|href="\/clients"/)
  })
})

describe('Persona 2 — generic client manager (e.g. School Test Organisation): no founder items leak in', () => {
  it('the client-org branch never references any founder-only surface: OpsDropdown, AdminDropdown, Founder OS, Clients, Reports, Data, Command', () => {
    expect(clientRegion).not.toContain('OpsDropdown')
    expect(clientRegion).not.toContain('AdminDropdown')
    expect(clientRegion).not.toMatch(/href="\/admin\/founder"|href="\/clients"|href="\/reports"|href="\/data"|href="\/command"/)
  })

  it('Events remains visible when enabledCapabilities includes it, and Requests remains unconditional — the two items a generic client IS meant to see', () => {
    expect(clientRegion).toMatch(/enabledCapabilities\.includes\(\s*\n?\s*'events',?\s*\n?\s*\)/)
    expect(clientRegion).toMatch(/href="\/dashboard\/pipeline"[\s\S]{0,60}label="Requests"/)
  })

  it('Squad, Sessions, Leads, and Blog are absent unless isLdTennis — a generic client organisation never sees them (proven in clientNavOwnership.test.ts; re-asserted here as part of full persona coverage)', () => {
    const leadsIdx = clientRegion.indexOf('href="/dashboard/leads"')
    const sessionsIdx = clientRegion.indexOf('href="/dashboard/sessions"')
    const blogIdx = clientRegion.indexOf('href="/dashboard/blog"')
    expect(clientRegion.lastIndexOf('isLdTennis && (', leadsIdx)).toBeGreaterThan(-1)
    expect(clientRegion.lastIndexOf('isLdTennis && (', sessionsIdx)).toBeGreaterThan(-1)
    expect(clientRegion.lastIndexOf('isLdTennis && (', blogIdx)).toBeGreaterThan(-1)
    expect(clientRegion).toContain('<SquadItem')
    const squadIdx = clientRegion.indexOf('<SquadItem')
    expect(clientRegion.lastIndexOf('isLdTennis && (', squadIdx)).toBeGreaterThan(-1)
  })
})

describe('Persona 3 — LD Tennis manager: full tennis navigation retained, founder tools never leak in', () => {
  it('LD Tennis (a manager-role client organisation) takes the SAME client-org branch as any other client — isManager being true never grants access to OpsDropdown/AdminDropdown, which exist only in the staff branch', () => {
    // isClientOrg = !isSuperAdmin && enabledModules.length === 0 — LD
    // Tennis's manager session has isSuperAdmin=false and (like every
    // organisation, due to the separate enabledModules bug)
    // enabledModules=[], so isClientOrg is true regardless of isManager.
    expect(topNavSource).toMatch(/const isClientOrg =\s*\n\s*!isSuperAdmin &&\s*\n\s*enabledModules\.length === 0;/)
    expect(clientRegion).not.toContain('OpsDropdown')
    expect(clientRegion).not.toContain('AdminDropdown')
  })

  it('Leads, Squad, Sessions, Blog, Requests, and Events are all reachable for isLdTennis (proven functionally in clientNavOwnership.test.ts; asserted here as part of full persona coverage)', () => {
    expect(clientRegion).toMatch(/isLdTennis && \(/)
    expect(clientRegion).toContain('href="/dashboard/leads"')
    expect(clientRegion).toContain('<SquadItem')
    expect(clientRegion).toContain('href="/dashboard/sessions"')
    expect(clientRegion).toContain('href="/dashboard/blog"')
    expect(clientRegion).toContain('href="/dashboard/pipeline"')
    expect(clientRegion).toMatch(/enabledCapabilities\.includes\(\s*\n?\s*'events',?\s*\n?\s*\)/)
  })

  it('no founder Admin tool (AdminDropdown, /admin/founder, /clients) is reachable from LD Tennis\'s branch', () => {
    expect(clientRegion).not.toContain('AdminDropdown')
    expect(clientRegion).not.toMatch(/href="\/admin\/founder"|href="\/clients"/)
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

  it('isSuperAdmin is threaded from the server-resolved session (app/dashboard/page.tsx) through BrainBase.jsx into LeftSidebar — never a client-side guess, never hardcoded', () => {
    expect(pageSource).toMatch(/<BrainBase enabledCapabilities=\{enabledCapabilities\} isSuperAdmin=\{session\.role === 'super_admin'\} \/>/)
    expect(brainBaseSource).toContain('function BrainBase({ enabledCapabilities = [], isSuperAdmin = false })')
    expect(brainBaseSource).toContain('<LeftSidebar open={sidebarOpen} onToggle={toggleSidebar} isSuperAdmin={isSuperAdmin} />')
  })
})
