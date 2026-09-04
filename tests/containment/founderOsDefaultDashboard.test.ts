import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness (same caveat as
// every other *StaticCheck.test.ts file in this suite).

const pageSource     = fs.readFileSync(path.resolve(__dirname, '../../app/dashboard/page.tsx'), 'utf-8')
const founderSource  = fs.readFileSync(path.resolve(__dirname, '../../app/admin/founder/page.tsx'), 'utf-8')
const adminLayoutSrc = fs.readFileSync(path.resolve(__dirname, '../../app/admin/layout.tsx'), 'utf-8')
const commandSource  = fs.readFileSync(path.resolve(__dirname, '../../app/command/page.tsx'), 'utf-8')
const middlewareSrc  = fs.readFileSync(path.resolve(__dirname, '../../middleware.ts'), 'utf-8')
const intelRouteSrc  = fs.readFileSync(path.resolve(__dirname, '../../app/api/admin/founder-intelligence/route.ts'), 'utf-8')

describe('app/dashboard/page.tsx — Brainbase org resolves to Founder OS', () => {
  it('1. a brainbase-hq variant redirects to the existing /admin/founder route', () => {
    expect(pageSource).toContain("if (variant === 'brainbase-hq') {")
    expect(pageSource).toContain("redirect('/admin/founder')")
  })

  it("6. resolution happens server-side — this is an async server component (no 'use client'), and redirect() is next/navigation's server API", () => {
    expect(pageSource).not.toContain("'use client'")
    expect(pageSource).toContain("import { redirect } from 'next/navigation'")
  })

  it('5. no specific user (James/Luke) is referenced anywhere in the routing logic', () => {
    expect(pageSource).not.toMatch(/james/i)
    expect(pageSource).not.toMatch(/luke/i)
    expect(pageSource).not.toMatch(/userId\s*===\s*['"]/)
  })

  it('2. the LD Tennis branch is unchanged — still renders TennisDashboard for the ld-tennis variant', () => {
    expect(pageSource).toContain("if (variant === 'ld-tennis') {")
    expect(pageSource).toContain('<TennisDashboard')
  })

  // Updated during the D.2.3 origin/main reconciliation merge: per that
  // task's explicit instruction, the generic (variant === null)
  // fallthrough now renders OrganisationDashboard (Phase C.2C — see
  // organisationDashboardSeparation.test.ts for the dedicated suite),
  // not <BrainBase enabledCapabilities={...} isSuperAdmin={...} />.
  // BrainBase.jsx's own enabledCapabilities/isSuperAdmin prop-threading
  // (into ModuleAccessCard and LeftSidebar respectively) remains
  // structurally correct — see moduleAccessCard.test.ts and
  // navPersonaCoverage.test.ts — it is simply no longer this call site;
  // its one remaining caller is the session-less auth-failure fallback.
  it('3. any other organisation (variant === null) still falls through to the generic dashboard shell (OrganisationDashboard, as of Phase C.2C)', () => {
    expect(pageSource).toMatch(/<OrganisationDashboard[\s\S]{0,300}enabledCapabilities=\{enabledCapabilities\}/)
  })
})

describe('7. client (non-super_admin) users cannot reach founder-only data through /dashboard', () => {
  it('the resolver itself gates brainbase-hq to super_admin (checked in the resolver test file)', () => {
    // Full coverage of this lives in clientDashboardResolver.test.ts —
    // this asserts the defense-in-depth layer: even if the resolver
    // were ever bypassed, Founder OS's own APIs independently re-check.
    // founder-intelligence is no longer fetched at all as of the Phase B
    // trust-boundary hardening round (see the '1D' describe block below) —
    // only founder-clients remains as a live example here.
    expect(founderSource).toContain("fetch('/api/admin/founder-clients')")
  })

  it('the founder-intelligence API route itself still independently enforces super_admin, even though the page no longer calls it', () => {
    expect(intelRouteSrc).toContain("session.role !== 'super_admin'")
  })

  it('the /admin section itself remains gated by middleware to super_admin only (Phase C1.6: now via the shared roleGte() helper, not a bespoke equality check — behaviourally identical, since nothing outranks super_admin)', () => {
    expect(middlewareSrc).toContain("pathname.startsWith('/admin')")
    expect(middlewareSrc).toContain("!roleGte(role, 'super_admin')")
  })
})

describe('8. the existing direct Founder OS route still works, unaffected', () => {
  it('app/admin/founder/page.tsx still exports the same FounderPage component', () => {
    expect(founderSource).toContain('export default function FounderPage()')
  })

  it('app/admin/layout.tsx still independently re-checks super_admin for the whole /admin section', () => {
    expect(adminLayoutSrc).toContain("session.role !== 'super_admin'")
  })
})

describe('9. /command (Command Centre) is untouched by this round', () => {
  it('still exports the same page component, still client-rendered, still municipal/ops-demo content', () => {
    expect(commandSource).toContain('"use client"')
    expect(commandSource).toContain('ALERTS')
    expect(commandSource).toContain('SYS_STATUS')
  })
})

describe('1D — Founder OS demo data is labelled, not presented as live', () => {
  it('the founder-intelligence API route itself still tags its response with source: live/demo (unmodified — the page just no longer calls it)', () => {
    expect(intelRouteSrc).toContain("source: 'live'")
    expect(intelRouteSrc).toContain("source: 'demo'")
  })

  it('Phase B trust-boundary hardening: the page no longer fetches founder-intelligence at all, and never conditionally shows a "demo" banner based on its source — HlnaBriefing is now an unconditional, permanent "not connected" shell regardless of that backend\'s live/demo state', () => {
    expect(founderSource).not.toContain("fetch('/api/admin/founder-intelligence')")
    expect(founderSource).not.toMatch(/intel\??\.source/)
    expect(founderSource).toContain('function HlnaBriefing()')
    expect(founderSource).toContain('Intelligence briefing not connected')
  })

  it('the previously unconditional "All systems operational" claim (backed by zero real health checks) is no longer shown as fact', () => {
    expect(founderSource).not.toContain('All systems operational')
  })
})
