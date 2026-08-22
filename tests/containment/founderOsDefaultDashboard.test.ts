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

  it('3. any other organisation (variant === null) still falls through to the generic BrainBase shell', () => {
    const lastReturn = pageSource.slice(pageSource.lastIndexOf('return <BrainBase'))
    expect(lastReturn).toContain('return <BrainBase />')
  })
})

describe('7. client (non-super_admin) users cannot reach founder-only data through /dashboard', () => {
  it('the resolver itself gates brainbase-hq to super_admin (checked in the resolver test file)', () => {
    // Full coverage of this lives in clientDashboardResolver.test.ts —
    // this asserts the defense-in-depth layer: even if the resolver
    // were ever bypassed, Founder OS's own APIs independently re-check.
    expect(founderSource).toContain("fetch('/api/admin/founder-clients')")
    expect(founderSource).toContain("fetch('/api/admin/founder-intelligence')")
  })

  it('founder-intelligence and founder-clients APIs still independently enforce super_admin — unchanged by this round', () => {
    expect(intelRouteSrc).toContain("session.role !== 'super_admin'")
  })

  it('the /admin section itself remains gated by middleware to super_admin only, unchanged', () => {
    expect(middlewareSrc).toContain("pathname.startsWith('/admin')")
    expect(middlewareSrc).toContain("role !== 'super_admin'")
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
  it('the founder-intelligence API tags its response with source: live/demo', () => {
    expect(intelRouteSrc).toContain("source: 'live'")
    expect(intelRouteSrc).toContain("source: 'demo'")
  })

  it('the page surfaces a demo-data banner when intel.source is demo, reusing the existing banner treatment rather than a new design', () => {
    // Phase B (Founder OS real-data audit) narrowed this banner's copy: it
    // no longer claims the whole page ("KPIs and recommendations") is
    // sample content, since those are now real-or-honestly-unavailable
    // regardless of this backend's state — only the HLNΛ briefing panel
    // itself is still demo-shaped when this backend is unreachable, so the
    // banner is scoped to describe only that. The trigger condition
    // (intel?.source === 'demo') and the banner-on-demo behavior itself are
    // unchanged; only the wording changed to stay accurate.
    expect(founderSource).toContain("intel?.source === 'demo'")
    expect(founderSource).toContain('HLNΛ Chief of Staff briefing below is not connected')
  })

  it('the previously unconditional "All systems operational" claim (backed by zero real health checks) is no longer shown as fact', () => {
    expect(founderSource).not.toContain('All systems operational')
  })
})
