import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Super_admin org switcher — restore/expose UI.
//
// Root cause (see this phase's own report): the switcher component
// already existed, was already mounted, and was already fully wired to
// the real /api/admin/impersonate backend — it was simply INVISIBLE.
// Both it and TopNav's own nav bar used `position: fixed/sticky, top: 0,
// zIndex: 100` — an exact tie at the same screen region, with TopNav
// mounted after it in app/layout.tsx, so TopNav painted over it
// completely. The fix removes all fixed/absolute-at-viewport positioning
// from OrgSwitcher and renders it as a normal, non-fixed, full-width bar
// ABOVE TopNav in the document's own flow — the two elements can no
// longer occupy the same screen region by construction, so no z-index
// value can ever re-create this bug. Same convention as every other UI
// test in this suite (no jsdom/React Testing Library harness here):
// static source-text assertions.
//
// A SEPARATE, related bug found and fixed while restoring this UI: both
// app/layout.tsx and app/api/me/route.ts (TopNav's server-rendered and
// client-fetch capability projections) resolved organisationId via the
// raw getSession() JWT decode, which is NEVER org_override-aware — so
// CRM/Events nav items always reflected the founder's OWN organisation's
// capabilities, even while actively impersonating a client org. Fixed by
// switching both to requireSession() (lib/org.ts), which already
// performs the org_override substitution — see
// tests/containment/apiMeCapabilityProjection.test.ts's own updated
// test 19 for the /api/me half of this proof.
//
// Production polish pass (dropdown layering + post-switch destination):
// once visible, the dropdown itself was still being clipped by TopNav —
// z-index alone doesn't help a descendant of a z-index:auto ancestor
// outrank a LATER sibling's own explicit stacking context. Fixed by
// giving the switcher bar's own wrapper an explicit z-index above
// TopNav's 100 (see the dedicated describe block below) — still no
// position: fixed anywhere. Separately, switching organisations used to
// window.location.reload() the CURRENT route, stranding a founder who
// switched from an admin-only page with no obvious way to reach the
// newly-active org's own workspace; now navigates to /dashboard, the
// same existing generic client-landing route already used everywhere
// else in the app.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const orgSwitcherSource = stripComments(read('components/admin/OrgSwitcher.tsx'))
const layoutSource = stripComments(read('app/layout.tsx'))

describe('OrgSwitcher — visibility bug root cause is structurally closed, not just patched', () => {
  it('renders no `position: fixed` anywhere — the exact mechanism that let it collide with TopNav\'s own fixed/sticky bar cannot recur', () => {
    expect(orgSwitcherSource).not.toMatch(/position:\s*'fixed'/)
  })

  it('the switcher bar remains a normal-flow element (position: relative, not fixed) — the invisibility fix itself is untouched by the later dropdown-layering fix', () => {
    expect(orgSwitcherSource).toContain("position: 'relative',")
    expect(orgSwitcherSource).not.toMatch(/position:\s*'fixed'/)
  })

  it('the switcher bar\'s own wrapper carries an explicit z-index ABOVE TopNav\'s zIndex: 100 — this is what lets its dropdown escape being clipped by TopNav\'s own stacking context, without moving the bar itself back to fixed positioning', () => {
    const wrapperStart = orgSwitcherSource.indexOf('position: \'relative\',')
    const wrapperZIndexRegion = orgSwitcherSource.slice(wrapperStart, wrapperStart + 400)
    const match = wrapperZIndexRegion.match(/zIndex:\s*(\d+)/)
    expect(match, 'expected an explicit zIndex near the wrapper\'s position: relative').not.toBeNull()
    expect(Number(match![1])).toBeGreaterThan(100)
  })

  it('is mounted before TopNav in app/layout.tsx (unchanged position — a normal-flow element earlier in the DOM naturally pushes TopNav down)', () => {
    const switcherIdx = layoutSource.indexOf('<OrgSwitcher')
    const topNavIdx = layoutSource.indexOf('<TopNav')
    expect(switcherIdx).toBeGreaterThan(-1)
    expect(topNavIdx).toBeGreaterThan(-1)
    expect(switcherIdx).toBeLessThan(topNavIdx)
  })

  it('no ancestor in the render chain (html/body, app/globals.css) clips overflow — a raised z-index alone cannot un-clip a dropdown if a parent hides overflow', () => {
    const globalsCss = read('app/globals.css')
    const htmlBlock = globalsCss.slice(globalsCss.indexOf('html {'), globalsCss.indexOf('}', globalsCss.indexOf('html {')))
    const bodyBlock = globalsCss.slice(globalsCss.indexOf('body {'), globalsCss.indexOf('}', globalsCss.indexOf('body {')))
    expect(htmlBlock).not.toMatch(/overflow:\s*hidden/)
    expect(bodyBlock).not.toMatch(/overflow:\s*hidden/)
    // SessionProvider/ThemeProvider wrap OrgSwitcher directly in
    // app/layout.tsx — confirm neither introduces its own clipping
    // container between the dropdown and the page's own edges.
    const sessionProvider = read('components/session/SessionProvider.tsx')
    expect(sessionProvider).not.toMatch(/overflow:\s*['"]?hidden/)
  })
})

describe('OrgSwitcher — role gating: super_admin only', () => {
  it('returns null before rendering anything unless state.role === \'super_admin\' — admin/manager/viewer see nothing', () => {
    expect(orgSwitcherSource).toContain("if (state.role !== 'super_admin') return null;")
  })

  it('the role check happens after fetching /api/me, which resolves the REAL current role server-side — never a client-supplied or hardcoded role', () => {
    const meIdx = orgSwitcherSource.indexOf("fetch('/api/me')")
    const roleCheckIdx = orgSwitcherSource.indexOf("if (state.role !== 'super_admin') return null;")
    expect(meIdx).toBeGreaterThan(-1)
    expect(roleCheckIdx).toBeGreaterThan(meIdx)
  })

  it('never derives visibility from a hardcoded role array or a role other than super_admin', () => {
    expect(orgSwitcherSource).not.toMatch(/\[\s*'admin'\s*,\s*'super_admin'\s*\]/)
    expect(orgSwitcherSource).not.toMatch(/role\s*===\s*'admin'/)
  })
})

describe('OrgSwitcher — reuses the existing /api/admin/impersonate backend exclusively (no second impersonation mechanism)', () => {
  it('the org list comes from the existing /api/admin/orgs endpoint, never a hardcoded array', () => {
    expect(orgSwitcherSource).toContain("fetch('/api/admin/orgs')")
    expect(orgSwitcherSource).not.toMatch(/School Test Organisation|City of Onkaparinga|LD Tennis/)
  })

  it('reads current impersonation state via GET /api/admin/impersonate on load', () => {
    expect(orgSwitcherSource).toContain("fetch('/api/admin/impersonate')")
  })

  it('selecting an organisation POSTs { orgId } to /api/admin/impersonate — the existing, already-approved route', () => {
    const start = orgSwitcherSource.indexOf('async function switchOrg')
    const block = orgSwitcherSource.slice(start)
    expect(block).toMatch(/fetch\('\/api\/admin\/impersonate',\s*\{\s*\n\s*method:\s*'POST'/)
    expect(block).toContain('JSON.stringify({ orgId })')
  })

  it('clearing (switchOrg(null) / "Return to Brainbase") DELETEs the same route — returning to the founder\'s home organisation, never a second "clear" mechanism', () => {
    const start = orgSwitcherSource.indexOf('async function switchOrg')
    const block = orgSwitcherSource.slice(start)
    expect(block).toMatch(/method:\s*'DELETE'/)
  })

  it('"Return to Brainbase" actions call switchOrg(null) — the same function and endpoint as every other switch, not a bespoke reset path', () => {
    expect((orgSwitcherSource.match(/switchOrg\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(2) // top-bar button + dropdown menu item
  })

  it('navigates to /dashboard after switching (both directions) — a full navigation, not a same-route reload, so every server-rendered surface (including capability-gated nav) picks up the new organisationId AND the founder lands somewhere navigable rather than stuck on whatever admin-only page they started from', () => {
    const start = orgSwitcherSource.indexOf('async function switchOrg')
    const block = orgSwitcherSource.slice(start)
    expect(block).toContain("window.location.href = '/dashboard'")
    expect(block).not.toContain('window.location.reload()')
  })

  it('/dashboard is the SAME existing generic client-landing route TopNav\'s own "Dashboard" nav link already points to — not a new or bespoke destination', () => {
    const topNavSource = read('components/nav/TopNav.tsx')
    expect((topNavSource.match(/href="\/dashboard"/g) ?? []).length).toBeGreaterThanOrEqual(2) // shared branch + isLdTennis branch
  })

  it('never redirects to /clients/[id] — that page is a read-only founder summary, never the impersonated app itself', () => {
    const start = orgSwitcherSource.indexOf('async function switchOrg')
    const block = orgSwitcherSource.slice(start)
    expect(block).not.toMatch(/\/clients\//)
  })

  it('/dashboard itself resolves organisationId via getAuthSession() (lib/authSession.ts), which independently performs the same org_override substitution — so this single redirect target is already correct for both switching into a client org and returning to Brainbase, with no org-specific branching needed in OrgSwitcher itself', () => {
    const dashboardPageSource = read('app/dashboard/page.tsx')
    const authSessionSource = read('lib/authSession.ts')
    expect(dashboardPageSource).toContain('getAuthSession()')
    expect(authSessionSource).toMatch(/org_override/)
    expect(authSessionSource).toMatch(/===\s*'super_admin'/)
  })
})

describe('CRM/Events nav reflects the ACTIVE impersonated organisation (not the founder\'s home org) — the second bug found and fixed alongside the visibility issue', () => {
  it('app/layout.tsx resolves session via requireSession() (org_override-aware), not the raw getSession() JWT decode', () => {
    expect(layoutSource).toContain("import { requireSession } from '@/lib/org';")
    expect(layoutSource).toContain('await requireSession()')
    expect(layoutSource).not.toMatch(/getSession\(\)/)
  })

  it('the enabledCapabilities and dashboardVariant projections both key off that same session.organisationId — no separately-resolved, override-unaware organisation id exists in this file', () => {
    const start = layoutSource.indexOf('if (session) {')
    const end = layoutSource.indexOf('serverSession = {', start)
    const block = layoutSource.slice(start, end)
    expect(block).toMatch(/om\.organisation_id\s*=\s*\$\{session\.organisationId\}/)
    expect(block).toMatch(/resolveDashboardVariant\(session\.organisationId, session\.role\)/)
  })

  it('role and name passed into serverSession remain the actual logged-in founder\'s own identity — impersonation changes which org\'s DATA is shown, never who the founder is', () => {
    const start = layoutSource.indexOf('serverSession = {')
    const end = layoutSource.indexOf('};', start)
    const block = layoutSource.slice(start, end)
    expect(block).toContain('role: session.role,')
    expect(block).toContain('name: session.name,')
  })
})
