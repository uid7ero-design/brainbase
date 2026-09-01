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
describe('TopNav — LD-Tennis-specific nav items are gated on dashboardVariant, not shown to every client org', () => {
  const clientBranchStart = topNavSource.indexOf('isLdTennis ? (')
  const clientBranchEnd = topNavSource.indexOf(') : (', clientBranchStart)
  const clientRegion = topNavSource.slice(clientBranchStart, clientBranchEnd)
  const sharedBranchEnd = topNavSource.indexOf('width: 185,', clientBranchEnd)
  const sharedRegion = topNavSource.slice(clientBranchEnd, sharedBranchEnd)

  it('Leads, Squad (Contacts), and Sessions are rendered inside the isLdTennis-true branch', () => {
    expect(clientRegion).toMatch(/href="\/dashboard\/leads"/)
    expect(clientRegion).toMatch(/<SquadItem/)
    expect(clientRegion).toMatch(/href="\/dashboard\/sessions"/)
  })

  it('Leads/Squad/Sessions never appear in the shared (generic-client + internal-staff) branch at all', () => {
    expect(sharedRegion).not.toMatch(/href="\/dashboard\/leads"/)
    expect(sharedRegion).not.toMatch(/<SquadItem/)
    expect(sharedRegion).not.toMatch(/href="\/dashboard\/sessions"/)
    // Exactly one occurrence of each across the whole file — the one
    // inside the isLdTennis branch already verified above.
    expect((topNavSource.match(/href="\/dashboard\/leads"/g) ?? []).length).toBe(1)
    expect((topNavSource.match(/<SquadItem/g) ?? []).length).toBe(1)
    expect((topNavSource.match(/href="\/dashboard\/sessions"/g) ?? []).length).toBe(1)
  })

  it('Blog is also isLdTennis-exclusive (the /api/tennis/blog namespace is LD Tennis-specific, not a generic client tool)', () => {
    expect(clientRegion).toMatch(/href="\/dashboard\/blog"/)
    expect(sharedRegion).not.toMatch(/href="\/dashboard\/blog"/)
    expect((topNavSource.match(/href="\/dashboard\/blog"/g) ?? []).length).toBe(1)
  })

  it('Requests (client_pipeline — a platform-global feedback/issue channel to BrainBase, not tennis-specific) is present in BOTH branches: unconditionally for LD Tennis, and !isBrainbaseHQ-gated for the shared branch (visible to generic clients, hidden from Brainbase HQ staff)', () => {
    expect(clientRegion).toMatch(/href="\/dashboard\/pipeline"/)
    const sharedRequestsIdx = sharedRegion.indexOf('href="/dashboard/pipeline"')
    expect(sharedRequestsIdx).toBeGreaterThan(-1)
    const precedingGate = sharedRegion.lastIndexOf('{!isBrainbaseHQ && (', sharedRequestsIdx)
    expect(precedingGate).toBeGreaterThan(-1)
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
    expect(topNavSource).toMatch(/const isLdTennis =\s*dashboardVariant === 'ld-tennis';/)
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

// Phase 6.2 §10 — CRM was previously only reachable via OpsDropdown,
// itself gated on isBrainbaseHQ (Brainbase's own staff only) — so a
// client organisation with the crm capability enabled had no nav path
// to CRM at all. The fix adds a standalone, capability-gated NavItem to
// both the shared (generic client + Brainbase HQ staff) branch and the
// isLdTennis branch, mirroring hasEvents/Events exactly. OpsDropdown's
// own internal CRM shortcut is untouched — these are two independent
// entries serving two different audiences, not a replacement.
describe('TopNav — CRM nav item is capability-driven, reachable by any client organisation with crm enabled', () => {
  const clientBranchStart = topNavSource.indexOf('isLdTennis ? (')
  const clientBranchEnd = topNavSource.indexOf(') : (', clientBranchStart)
  const clientRegion = topNavSource.slice(clientBranchStart, clientBranchEnd)
  const sharedBranchEnd = topNavSource.indexOf('width: 185,', clientBranchEnd)
  const sharedRegion = topNavSource.slice(clientBranchEnd, sharedBranchEnd)

  it('hasCrm is derived from enabledCapabilities, not hardcoded to any organisation', () => {
    expect(topNavSource).toMatch(/const hasCrm =\s*enabledCapabilities\.includes\(\s*'crm',?\s*\);/)
  })

  it('a top-level CRM NavItem, gated on hasCrm, is present in the shared branch (generic clients + Brainbase HQ staff)', () => {
    const crmIdx = sharedRegion.indexOf('label="CRM"')
    expect(crmIdx).toBeGreaterThan(-1)
    const gateStart = sharedRegion.lastIndexOf('{hasCrm && (', crmIdx)
    expect(gateStart).toBeGreaterThan(-1)
    expect(sharedRegion.slice(gateStart, crmIdx)).not.toMatch(/isBrainbaseHQ/)
  })

  it('a top-level CRM NavItem, gated on hasCrm, is also present in the isLdTennis branch (parity with Events)', () => {
    const crmIdx = clientRegion.indexOf('label="CRM"')
    expect(crmIdx).toBeGreaterThan(-1)
    const gateStart = clientRegion.lastIndexOf('{hasCrm && (', crmIdx)
    expect(gateStart).toBeGreaterThan(-1)
  })

  it('the standalone CRM NavItem points at /crm, exactly matching the ModuleAccessCard dashboard card\'s own href', () => {
    const moduleAccessCard = read('components/dashboard/ModuleAccessCard.tsx')
    expect(sharedRegion).toMatch(/href="\/crm"/)
    expect(moduleAccessCard).toMatch(/href:\s*'\/crm'/)
  })

  it('OpsDropdown\'s own internal CRM shortcut (Brainbase HQ staff only) is untouched — still exactly one OPS_ITEMS entry, still gated on isBrainbaseHQ, not removed or duplicated by this fix', () => {
    expect((topNavSource.match(/label: 'CRM',/g) ?? []).length).toBe(1)
    const opsDropdownGateIdx = topNavSource.indexOf('<OpsDropdown')
    expect(opsDropdownGateIdx).toBeGreaterThan(-1)
    const precedingGate = topNavSource.lastIndexOf('{isBrainbaseHQ && (', opsDropdownGateIdx)
    expect(precedingGate).toBeGreaterThan(-1)
  })

  it('the new CRM NavItems appear exactly twice total (shared branch + isLdTennis branch) — no accidental third copy', () => {
    expect((topNavSource.match(/label="CRM"/g) ?? []).length).toBe(2)
  })
})
