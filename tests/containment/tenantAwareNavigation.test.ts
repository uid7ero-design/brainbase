import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

// Phase C.2D — tenant-aware TopNav/LeftSidebar. Static source-text
// containment per this repo's convention (no jsdom/RTL harness); see
// AGENTS.md/CLAUDE.md and every prior phase's test file for the pattern.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf-8')

const topNavSource = read('components/nav/TopNav.tsx')
const layoutSource = read('app/layout.tsx')
const sidebarSource = read('components/layout/LeftSidebar.jsx')
const clientDashboardSource = read('lib/dashboard/clientDashboard.ts')

describe('Phase C.2D — the isClientOrg heuristic is gone', () => {
  it('TopNav no longer classifies tenants via enabledModules.length === 0', () => {
    expect(topNavSource).not.toContain('enabledModules.length === 0')
    expect(topNavSource).not.toContain('isClientOrg')
  })

  it('classification is driven by the same dashboardVariant resolver app/dashboard/page.tsx uses, not a second system', () => {
    expect(topNavSource).toMatch(/dashboardVariant\s*===\s*'ld-tennis'/)
    expect(topNavSource).toMatch(/dashboardVariant\s*===\s*'brainbase-hq'/)
    // clientDashboard.ts itself is untouched — the resolver is reused, not
    // reimplemented or forked.
    expect(clientDashboardSource).toMatch(/BRAINBASE_SLUG = 'brainbase'/)
    expect(clientDashboardSource).toMatch(/'ld-tennis': 'ld-tennis'/)
  })

  it('app/layout.tsx resolves dashboardVariant server-side via resolveDashboardVariant and passes it to TopNav', () => {
    expect(layoutSource).toMatch(/import \{ resolveDashboardVariant \} from '@\/lib\/dashboard\/clientDashboard'/)
    expect(layoutSource).toMatch(/resolveDashboardVariant\(\s*session\.organisationId,\s*session\.role,?\s*\)/)
    expect(layoutSource).toMatch(/dashboardVariant,?\s*\n?\s*\};/)
  })
})

describe('Phase C.2D — generic tenant navigation', () => {
  it('generic tenants get a Dashboard entry pointing at /dashboard', () => {
    const elseBranchStart = topNavSource.indexOf('isLdTennis ? (')
    const elseBranchIdx = topNavSource.indexOf(') : (', elseBranchStart)
    const genericBranch = topNavSource.slice(elseBranchIdx)
    expect(genericBranch).toMatch(/!isBrainbaseHQ && \(/)
    expect(genericBranch).toMatch(/href="\/dashboard"/)
    expect(genericBranch).toMatch(/label="Dashboard"/)
  })

  it('generic tenants get HLNA pointed at /hlna, not /dashboard', () => {
    const elseBranchStart = topNavSource.indexOf('isLdTennis ? (')
    const elseBranchIdx = topNavSource.indexOf(') : (', elseBranchStart)
    const genericBranch = topNavSource.slice(elseBranchIdx)
    const hlnaMatch = genericBranch.match(/<HlnaItem[\s\S]{0,260}?\/>/)
    expect(hlnaMatch).not.toBeNull()
    expect(hlnaMatch![0]).toContain("href=\"/hlna\"")
  })

  it('Events & Ticketing appears only when hasEvents (enabledCapabilities.includes(\'events\')) is true, never hardcoded to an org name', () => {
    expect(topNavSource).toMatch(/const hasEvents =\s*\n?\s*enabledCapabilities\.includes\(\s*\n?\s*'events',?\s*\n?\s*\);/)
    expect(topNavSource).toMatch(/\{hasEvents && \(/)
    expect(topNavSource).toMatch(/href="\/events"/)
    expect(topNavSource).toMatch(/label="Events & Ticketing"/)
    // Never gated on a hardcoded org name/slug string.
    const eventsBlockStart = topNavSource.indexOf('{hasEvents && (')
    const eventsBlockEnd = topNavSource.indexOf(')}', eventsBlockStart)
    const eventsBlock = topNavSource.slice(eventsBlockStart, eventsBlockEnd)
    expect(eventsBlock).not.toMatch(/organisation(Name|Slug)/i)
    expect(eventsBlock).not.toContain('School Test')
  })

  it('active-state matching for /events is prefix-based so /events/[id] still highlights it', () => {
    const eventsItemMatch = topNavSource.match(/href="\/events"[\s\S]{0,200}?active=\{[\s\S]{0,80}?\}/)
    expect(eventsItemMatch).not.toBeNull()
    expect(eventsItemMatch![0]).toMatch(/pathname\.startsWith\(\s*\n?\s*'\/events',?\s*\n?\s*\)/)
  })

  it('active-state matching for /hlna is prefix-based', () => {
    const elseBranchStart = topNavSource.indexOf('isLdTennis ? (')
    const elseBranchIdx = topNavSource.indexOf(') : (', elseBranchStart)
    const genericBranch = topNavSource.slice(elseBranchIdx)
    const hlnaMatch = genericBranch.match(/<HlnaItem[\s\S]{0,260}?\/>/)
    expect(hlnaMatch![0]).toMatch(/pathname\.startsWith\(\s*\n?\s*'\/hlna',?\s*\n?\s*\)/)
  })
})

describe('Phase C.2D — a generic zero-module tenant does not receive the LD Tennis menu', () => {
  it('the LD Tennis Leads/SquAd/Sessions/Requests/Blog block is reachable only via isLdTennis, never via an enabledModules/enabledCapabilities length check', () => {
    const ldTennisBlockStart = topNavSource.indexOf('{isLdTennis ? (')
    expect(ldTennisBlockStart).toBeGreaterThan(-1)
    const ldTennisBlockEnd = topNavSource.indexOf(') : (', ldTennisBlockStart)
    const ldTennisBlock = topNavSource.slice(ldTennisBlockStart, ldTennisBlockEnd)
    expect(ldTennisBlock).toContain("label=\"Leads\"")
    expect(ldTennisBlock).toContain('SquadItem')
    expect(ldTennisBlock).toContain("label=\"Sessions\"")
    expect(ldTennisBlock).toContain("label=\"Requests\"")
    expect(ldTennisBlock).toContain("label=\"Blog\"")
    // The gate itself is dashboardVariant === 'ld-tennis' — confirm no
    // *active* code path still branches on enabledModules (a handful of
    // harmless references remain: the Session type field and the dead
    // /api/me client-fetch fallback mapping, neither of which drives
    // this decision any more).
    expect(topNavSource).not.toContain('enabledModules.length')
    expect(topNavSource).not.toContain('isClientOrg')
  })
})

describe('Phase C.2D — LD Tennis preservation', () => {
  it('LD Tennis keeps its bespoke HLNA entry pointing at /dashboard (audited, deliberately preserved)', () => {
    const ldTennisBlockStart = topNavSource.indexOf('{isLdTennis ? (')
    const ldTennisBlockEnd = topNavSource.indexOf(') : (', ldTennisBlockStart)
    const ldTennisBlock = topNavSource.slice(ldTennisBlockStart, ldTennisBlockEnd)
    const hlnaMatch = ldTennisBlock.match(/<HlnaItem[\s\S]{0,160}?\/>/)
    expect(hlnaMatch).not.toBeNull()
    expect(hlnaMatch![0]).toContain("href=\"/dashboard\"")
  })

  it('all five bespoke LD Tennis nav destinations are unchanged from before this phase', () => {
    expect(topNavSource).toContain('href="/dashboard/leads"')
    expect(topNavSource).toContain('/dashboard/contacts')
    expect(topNavSource).toContain('href="/dashboard/sessions"')
    expect(topNavSource).toContain('href="/dashboard/pipeline"')
    expect(topNavSource).toContain('href="/dashboard/blog"')
  })
})

describe('Phase C.2D — Founder OS / super_admin preservation', () => {
  it('the Founder OS nav entry is untouched: still isSuperAdmin-gated, still points at /admin/founder', () => {
    expect(topNavSource).toMatch(/isSuperAdmin && \(\s*\n\s*<NavItem\s*\n\s*href="\/admin\/founder"\s*\n\s*label="Founder OS"/)
  })

  it('brainbase-hq super_admin does not get a redundant Dashboard entry (their /dashboard already redirects to Founder OS)', () => {
    const elseBranchStart = topNavSource.indexOf('isLdTennis ? (')
    const elseBranchIdx = topNavSource.indexOf(') : (', elseBranchStart)
    const genericBranch = topNavSource.slice(elseBranchIdx)
    expect(genericBranch).toContain('{!isBrainbaseHQ && (')
    const guardStart = genericBranch.indexOf('{!isBrainbaseHQ && (')
    const guardRegion = genericBranch.slice(guardStart, guardStart + 200)
    expect(guardRegion).toContain('href="/dashboard"')
    expect(guardRegion).toContain('label="Dashboard"')
  })

  it('Clients and AdminDropdown remain isSuperAdmin-gated (unchanged); Operations/Reports/Data are now Brainbase-HQ-only, not any manager-role tenant', () => {
    expect(topNavSource).toMatch(/isSuperAdmin && \(\s*\n\s*<NavItem\s*\n\s*href="\/clients"/)
    expect(topNavSource).toMatch(/isBrainbaseHQ && \(\s*\n\s*<OpsDropdown/)
    expect(topNavSource).toMatch(/isBrainbaseHQ && \(\s*\n\s*<NavItem\s*\n\s*href="\/reports"/)
    expect(topNavSource).toMatch(/isBrainbaseHQ && \(\s*\n\s*<NavItem\s*\n\s*href="\/data"/)
    expect(topNavSource).toMatch(/isSuperAdmin && \(\s*\n\s*<AdminDropdown/)
  })

  it('Command entry (/command) is now Brainbase-HQ-gated, not any manager-role tenant, and still separate from Dashboard', () => {
    expect(topNavSource).toMatch(/isBrainbaseHQ && \(\s*\n\s*<NavItem\s*\n\s*href="\/command"/)
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
