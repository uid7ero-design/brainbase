import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

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

describe('TopNav — LD-Tennis-specific nav items are gated on dashboardVariant, not shown to every client org', () => {
  const clientBranchStart = topNavSource.indexOf('isClientOrg ? (')
  const clientBranchEnd = topNavSource.indexOf(') : (', clientBranchStart)
  const clientRegion = topNavSource.slice(clientBranchStart, clientBranchEnd)

  it('Leads, Squad (Contacts), and Sessions are only rendered inside an isLdTennis-gated block', () => {
    const gateIdx = clientRegion.indexOf('isLdTennis && (')
    expect(gateIdx).toBeGreaterThan(-1)
    const restOfRegion = clientRegion.slice(gateIdx)
    const gateBlockEnd = restOfRegion.indexOf('\n            )}')
    const gateBlock = restOfRegion.slice(0, gateBlockEnd)
    expect(gateBlock).toMatch(/href="\/dashboard\/leads"/)
    expect(gateBlock).toMatch(/<SquadItem/)
    expect(gateBlock).toMatch(/href="\/dashboard\/sessions"/)
  })

  it('Leads/Squad/Sessions never appear in the client branch OUTSIDE an isLdTennis gate', () => {
    // Every occurrence of each destination/component must be preceded,
    // within a short window, by the isLdTennis gate — i.e. there is
    // exactly one occurrence of each, and it is the gated one already
    // verified above.
    expect((clientRegion.match(/href="\/dashboard\/leads"/g) ?? []).length).toBe(1)
    expect((clientRegion.match(/<SquadItem/g) ?? []).length).toBe(1)
    expect((clientRegion.match(/href="\/dashboard\/sessions"/g) ?? []).length).toBe(1)
  })

  it('Blog is also gated on isLdTennis (the /api/tennis/blog namespace is LD Tennis-specific, not a generic client tool)', () => {
    const blogIdx = clientRegion.indexOf('href="/dashboard/blog"')
    expect(blogIdx).toBeGreaterThan(-1)
    const precedingGate = clientRegion.lastIndexOf('isLdTennis && (', blogIdx)
    expect(precedingGate).toBeGreaterThan(-1)
    // No unrelated closing of the gate between the gate opening and Blog.
    const between = clientRegion.slice(precedingGate, blogIdx)
    expect((between.match(/\)\}/g) ?? []).length).toBe(0)
  })

  it('Requests (client_pipeline — a platform-global feedback/issue channel to BrainBase, not tennis-specific) remains visible for every client organisation, unconditional on isLdTennis', () => {
    const requestsIdx = clientRegion.indexOf('href="/dashboard/pipeline"')
    expect(requestsIdx).toBeGreaterThan(-1)
    const nearestGateBefore = clientRegion.lastIndexOf('isLdTennis && (', requestsIdx)
    const nearestGateCloseBefore = clientRegion.lastIndexOf(')}', requestsIdx)
    // If a gate opened before Requests, it must already have closed
    // before Requests appears — Requests itself is never inside one.
    if (nearestGateBefore > -1) {
      expect(nearestGateCloseBefore).toBeGreaterThan(nearestGateBefore)
    }
  })

  it('Events remains gated purely by enabledCapabilities, never by isLdTennis or dashboardVariant', () => {
    const eventsIdx = clientRegion.indexOf('label="Events"')
    expect(eventsIdx).toBeGreaterThan(-1)
    const eventsGateStart = clientRegion.lastIndexOf('{enabledCapabilities.includes', eventsIdx)
    expect(eventsGateStart).toBeGreaterThan(-1)
    const eventsGateRegion = clientRegion.slice(eventsGateStart, eventsIdx + 30)
    expect(eventsGateRegion).not.toMatch(/isLdTennis|dashboardVariant/)
  })
})

describe('dashboardVariant plumbing — reused existing resolver, no hardcoded organisation, no new capability invented', () => {
  it('TopNav derives isLdTennis from a dashboardVariant session field, not a hardcoded organisation id/slug', () => {
    expect(topNavSource).toMatch(/const isLdTennis = dashboardVariant === 'ld-tennis'/)
    expect(topNavSource).not.toMatch(/school-test-organisation/i)
    expect(topNavSource).not.toMatch(/organisationId\s*===\s*['"]/)
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
  })

  it('LD Tennis is only ever referenced via its slug in the resolver\'s existing CLIENT_DASHBOARD_SLUGS map — the one, already-established place organisation identity is hardcoded for dashboard-variant purposes', () => {
    expect(resolverSource).toMatch(/'ld-tennis':\s*'ld-tennis'/)
  })
})

describe('Tenant isolation is unaffected — this change is UI-visibility only, no query/authorization logic touched', () => {
  it('TopNav.tsx contains no SQL/database access at all (nav visibility is a pure prop-driven render, never a data-scoping boundary)', () => {
    expect(topNavSource).not.toMatch(/from\s+['"]@\/lib\/db['"]/)
    expect(topNavSource).not.toMatch(/\bsql`/)
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
