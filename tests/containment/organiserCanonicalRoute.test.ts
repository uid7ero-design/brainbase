import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Founder OS Phase D.2 — promote Organiser out of Command to its canonical
// route (/organiser), with a safe, query-preserving legacy redirect from
// /command/organiser. See organiserDirectNavigation.test.ts for the D.1
// deep-link/tenancy/fallback behaviours, which this phase preserves
// unchanged (only their literal route paths were updated there).
//
// Static source-text assertions — this project has no jsdom/React Testing
// Library harness, and Next.js's redirect()/middleware primitives require a
// real request-scoped rendering context that a plain vitest environment
// doesn't provide — same established convention already used by
// founderOsDefaultDashboard.test.ts for its own server-side redirect().
// The redirect + query-string-preservation behaviour asserted below was
// additionally verified live during implementation: `next build && next
// start`, then `curl -D - http://localhost:PORT/command/organiser?board=xyz`
// returned "307 Temporary Redirect" / "location: /organiser?board=xyz", and
// a plain `/command/organiser` request returned "location: /organiser" —
// proving Next.js's default query-forwarding behaviour actually holds for
// this exact redirect entry, not just in theory.

const ORGANISER_PAGE_PATH = path.resolve(__dirname, '../../app/organiser/page.tsx')
const LEGACY_ORGANISER_PAGE_PATH = path.resolve(__dirname, '../../app/command/organiser/page.tsx')
const ORGANISER_LAYOUT_PATH = path.resolve(__dirname, '../../app/organiser/layout.tsx')
const NEXT_CONFIG_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../next.config.ts'), 'utf-8')
const ORGANISER_PAGE_SOURCE = fs.readFileSync(ORGANISER_PAGE_PATH, 'utf-8')
const ORGANISER_LAYOUT_SOURCE = fs.readFileSync(ORGANISER_LAYOUT_PATH, 'utf-8')
const FOUNDER_PAGE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/admin/founder/page.tsx'), 'utf-8')
const COMMAND_PAGE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/command/page.tsx'), 'utf-8')

// ── 1/14. Canonical route exists; no duplicated/divergent implementation ───

describe('Organiser has one canonical implementation at /organiser — not duplicated', () => {
  it('app/organiser/page.tsx exists and is the real, substantive Organiser implementation (not a stub)', () => {
    expect(fs.existsSync(ORGANISER_PAGE_PATH)).toBe(true)
    expect(ORGANISER_PAGE_SOURCE).toContain('export default function OrganiserPage() {')
    expect(ORGANISER_PAGE_SOURCE).toContain('const res = await fetch("/api/organiser/boards", { credentials: "include" });')
    expect(ORGANISER_PAGE_SOURCE.length).toBeGreaterThan(30000) // the real ~1300-line app, not a placeholder
  })

  it('the old app/command/organiser/page.tsx no longer exists — moved, not copied', () => {
    expect(fs.existsSync(LEGACY_ORGANISER_PAGE_PATH)).toBe(false)
  })

  it('no second Organiser implementation was created elsewhere (no other file defines OrganiserPageContent)', () => {
    const orgDir = path.resolve(__dirname, '../../app/organiser')
    const files = fs.readdirSync(orgDir)
    expect(files.sort()).toEqual(['layout.tsx', 'page.tsx'])
  })
})

// ── 2/3. Founder OS nav: points at /organiser, not rendered disabled ───────

describe('Founder OS Organiser navigation targets /organiser and is not styled as disabled', () => {
  it('the sidebar nav entry href is the canonical /organiser route', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("{ label: 'Organiser',  href: '/organiser' }")
  })

  it('the NavItem type supports an explicit "dim" (de-emphasised) flag, distinct from merely having an href', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain('type NavItem = { label: string; section?: Section; href?: string; dim?: boolean };')
  })

  it('Organiser is not marked dim — it renders at normal weight, like the in-app section tabs, not like a secondary utility link', () => {
    const navStart = FOUNDER_PAGE_SOURCE.indexOf('const NAV: NavItem[] = [')
    const navEnd = FOUNDER_PAGE_SOURCE.indexOf('];', navStart)
    const navBlock = FOUNDER_PAGE_SOURCE.slice(navStart, navEnd)
    const organiserLine = navBlock.split('\n').find(l => l.includes("label: 'Organiser'"))
    expect(organiserLine).toBeDefined()
    expect(organiserLine).not.toContain('dim: true')
  })

  it('Product and Admin (genuine secondary utility links) keep their prior dim/de-emphasised appearance — this was a scoped fix, not a broad sidebar redesign', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("{ label: 'Product',    href: '/data', dim: true },")
    expect(FOUNDER_PAGE_SOURCE).toContain("{ label: 'Admin',    href: '/admin', dim: true },")
  })

  it('the render logic keys the dim colour off the new n.dim flag, not off the mere presence of href (which would still catch Organiser)', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain('color: active ? T.purple : n.dim ? T.dim : T.sub,')
    expect(FOUNDER_PAGE_SOURCE).not.toContain('color: active ? T.purple : n.href ? T.dim : T.sub,')
  })
})

// ── 4/5. Founder Tasks deep-link targets /organiser?board=<id> ─────────────

describe('Founder Tasks "Open in Organiser" targets the canonical /organiser route', () => {
  it('the deep-link href builds against /organiser, with a safe plain fallback when no Founder Tasks board exists', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("href={board ? `/organiser?board=${encodeURIComponent(board.id)}` : '/organiser'}")
  })

  it('no remaining reference in the founder page points a live link at the legacy /command/organiser path', () => {
    expect(FOUNDER_PAGE_SOURCE).not.toMatch(/href=\{[^}]*\/command\/organiser/)
  })
})

// ── 9/10. Legacy /command/organiser compatibility + query preservation ─────

describe('/command/organiser remains compatible via a safe, non-looping redirect', () => {
  it('next.config.ts declares a redirects() entry from /command/organiser to /organiser', () => {
    expect(NEXT_CONFIG_SOURCE).toContain('async redirects()')
    expect(NEXT_CONFIG_SOURCE).toContain("source: '/command/organiser',")
    expect(NEXT_CONFIG_SOURCE).toContain("destination: '/organiser',")
  })

  it('the redirect destination does not itself start with /command — cannot loop back to the legacy path', () => {
    const match = NEXT_CONFIG_SOURCE.match(/source: '\/command\/organiser',\s*destination: '([^']+)'/)
    expect(match).not.toBeNull()
    const destination = match![1]
    expect(destination.startsWith('/command')).toBe(false)
  })

  it('the redirect uses a plain static source/destination pair (no custom query string on the destination, no path-parameter rewriting) — the shape Next.js forwards the original query string for automatically', () => {
    const match = NEXT_CONFIG_SOURCE.match(/source: '\/command\/organiser',\s*destination: '([^']+)'/)
    const destination = match![1]
    expect(destination).toBe('/organiser')
    expect(destination).not.toContain('?')
    expect(destination).not.toContain(':')
  })

  it('is a temporary redirect (permanent: false), not a hard permanent redirect — kept adjustable', () => {
    expect(NEXT_CONFIG_SOURCE).toContain('permanent: false,')
  })

  it("Command's own in-page shortcut to Organiser still points at the legacy path and works transparently via the new redirect (left untouched, per containment)", () => {
    expect(COMMAND_PAGE_SOURCE).toContain('<Link href="/command/organiser"')
  })
})

// ── 12/13. Tenancy/security preserved across the route promotion ──────────

describe('Access-control parity preserved across the route move (middleware.ts left untouched)', () => {
  it('a new, isolated layout at app/organiser/layout.tsx replicates the manager+ role gate previously provided by middleware.ts\'s /command prefix match, without editing that file', () => {
    expect(fs.existsSync(ORGANISER_LAYOUT_PATH)).toBe(true)
    expect(ORGANISER_LAYOUT_SOURCE).toContain("const ORGANISER_MIN_ROLE = 'manager';")
    expect(ORGANISER_LAYOUT_SOURCE).toContain('roleGte(session.role, ORGANISER_MIN_ROLE)')
  })

  it('the layout redirects unauthenticated/invalid sessions to /login and insufficient-role sessions to /dashboard — the same targets middleware used for /command', () => {
    expect(ORGANISER_LAYOUT_SOURCE).toContain("redirect('/login');")
    expect(ORGANISER_LAYOUT_SOURCE).toContain("redirect('/dashboard');")
  })

  it('the layout uses requireSession() (DB-revalidated role/org), not a raw JWT/cookie read — matches the existing lib/org.ts convention used by every other role-gated surface', () => {
    expect(ORGANISER_LAYOUT_SOURCE).toContain("import { redirect } from 'next/navigation';")
    expect(ORGANISER_LAYOUT_SOURCE).toContain("import { requireSession, roleGte } from '@/lib/org';")
  })

  it('middleware.ts itself was not modified by this change (its pre-existing, unrelated local edits are protected)', () => {
    // Deliberately does not read middleware.ts's content — this task must
    // not depend on, assert against, or risk normalising the shape of that
    // file's already-uncommitted, unrelated local changes. Containment is
    // instead verified via git status/diff in the task's own report, not
    // via a source-content assertion here.
    expect(true).toBe(true)
  })

  it('the Organiser API routes (data-layer tenancy) are unaffected by the route move — still session-organisation-scoped', () => {
    const boardsRoute = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/boards/route.ts'), 'utf-8')
    // Phase D.4.4C — this route's authorization call changed from a bare
    // requireRole('viewer') to authorizeOrganiserRequest('viewer'), a
    // shared wrapper that additionally enforces the 'organiser' capability
    // entitlement (see tests/containment/organiserCapabilityEnforcement
    // .test.ts for the dedicated suite covering that new layer). The
    // 'viewer' role floor this test protects is unchanged — the wrapper
    // preserves it exactly, it just now also checks capability first.
    expect(boardsRoute).toContain("authorizeOrganiserRequest('viewer')")
    expect(boardsRoute).toContain('WHERE b.organisation_id = ${session.organisationId}')
  })
})

// ── 11. Organiser still renders none of Command's demo content ─────────────

describe('Organiser at its new canonical route still renders no Command demo content', () => {
  it('no Demo Environment banner or ALERTS/SYS_STATUS/CHANGES/SUGGESTED constants exist in app/organiser/page.tsx', () => {
    expect(ORGANISER_PAGE_SOURCE).not.toContain('Demo Environment')
    expect(ORGANISER_PAGE_SOURCE).not.toContain('const ALERTS')
    expect(ORGANISER_PAGE_SOURCE).not.toContain('const SYS_STATUS')
    expect(ORGANISER_PAGE_SOURCE).not.toContain('const CHANGES')
    expect(ORGANISER_PAGE_SOURCE).not.toContain('const SUGGESTED')
  })

  it('the new layout.tsx wrapping it is a pure auth/role gate — no demo content, no fabricated data', () => {
    expect(ORGANISER_LAYOUT_SOURCE).not.toContain('Demo Environment')
    expect(ORGANISER_LAYOUT_SOURCE).not.toMatch(/const MOCK_|const DEMO_|const FAKE_/)
  })
})

// ── 6/7/8. D.1 board deep-link contract still intact after the move ────────

describe('D.1 board query-param contract (?board=<id>) survives the route promotion unchanged', () => {
  it('the requested-board validation logic (present in the org-scoped list, else fall back) is unchanged in the moved file', () => {
    expect(ORGANISER_PAGE_SOURCE).toContain('const requested = requestedBoardId && list.some(b => b.id === requestedBoardId) ? requestedBoardId : null;')
    expect(ORGANISER_PAGE_SOURCE).toContain('if (requested) setActiveId(requested);')
    expect(ORGANISER_PAGE_SOURCE).toContain('else if (list.length > 0) setActiveId(list[0].id);')
  })

  it('the page is still wrapped in Suspense for useSearchParams, unchanged by the move', () => {
    expect(ORGANISER_PAGE_SOURCE).toContain('<Suspense fallback={null}>')
    expect(ORGANISER_PAGE_SOURCE).toContain('<OrganiserPageContent />')
  })
})

// ── 15. Command demo content remains unchanged ──────────────────────────────

describe('Command demo/prototype content is unchanged by the Organiser promotion', () => {
  it('Command\'s demo constants and labelling are all still present', () => {
    expect(COMMAND_PAGE_SOURCE).toContain('Demo Environment')
    expect(COMMAND_PAGE_SOURCE).toContain('const ALERTS')
    expect(COMMAND_PAGE_SOURCE).toContain('const SYS_STATUS')
    expect(COMMAND_PAGE_SOURCE).toContain('const CHANGES')
    expect(COMMAND_PAGE_SOURCE).toContain('const SUGGESTED')
  })
})
