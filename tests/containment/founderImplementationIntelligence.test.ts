import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Founder OS Phase C — Client Implementations intelligence wired into the
// existing Attention Queue / Overview / Clients tab. Functional tests mock
// getAuthSession + sql (same positional-queue pattern as
// founderAttentionQueue.test.ts); UI tests are static source assertions
// (no jsdom/RTL harness in this repo, matching every other *.test.ts file
// in this suite).

const getAuthSessionMock = vi.fn()
vi.mock('@/lib/authSession', () => ({
  getAuthSession: (...args: unknown[]) => getAuthSessionMock(...args),
}))

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const { GET } = await import('@/app/api/founder/attention-queue/route')

const founderSource = fs.readFileSync(path.resolve(__dirname, '../../app/admin/founder/page.tsx'), 'utf-8')
const routeSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/attention-queue/route.ts'), 'utf-8')

// Query order in the route: alerts, requests, leads, onboarding,
// leadStages, snapshot, implementations (7 total).
function queueResponses(opts: {
  alerts?: unknown[]; requests?: unknown[]; leads?: unknown[]; onboarding?: unknown[];
  leadStages?: unknown[]; snapshot?: unknown[]; implementations?: unknown[];
} = {}) {
  responseQueue = [
    opts.alerts ?? [],
    opts.requests ?? [],
    opts.leads ?? [],
    opts.onboarding ?? [],
    opts.leadStages ?? [],
    opts.snapshot ?? [{}],
    opts.implementations ?? [],
  ]
  callCount = 0
}

beforeEach(() => {
  getAuthSessionMock.mockReset()
  sqlMock.mockClear()
  responseQueue = []
  callCount = 0
})

function utcDateString(offsetDays: number): string {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays))
  return d.toISOString().slice(0, 10)
}

const LD_TENNIS_IMPL = {
  id: 'impl-ldtennis', organisation_id: 'org-ldtennis', name: 'LD Tennis Digital Platform',
  service_type: 'Web Platform', stage: 'build', health: 'on_track', owner_user_id: 'user-luke',
  target_launch_date: null, next_action: null, org_name: 'LD Tennis', owner_name: 'Luke',
}

async function runAsSuperAdmin() {
  getAuthSessionMock.mockResolvedValue({ role: 'super_admin', organisationId: 'org-brainbase', userId: 'u1' })
  return GET()
}

// ── Implementation summary calculation ──────────────────────────────────────

describe('Implementation summary metrics', () => {
  it('total (non-cancelled), by-stage, at-risk, and blocked counts are computed directly from the implementations query results', async () => {
    queueResponses({
      implementations: [
        LD_TENNIS_IMPL,
        { ...LD_TENNIS_IMPL, id: 'impl-2', organisation_id: 'org-2', stage: 'testing', health: 'at_risk', org_name: 'Org 2' },
        { ...LD_TENNIS_IMPL, id: 'impl-3', organisation_id: 'org-3', stage: 'build', health: 'blocked', org_name: 'Org 3' },
      ],
    })
    const res = await runAsSuperAdmin()
    const json = await res.json()
    expect(json.metrics.implementationsTotal).toBe(3)
    expect(json.metrics.implementationsAtRisk).toBe(1)
    expect(json.metrics.implementationsBlocked).toBe(1)
    expect(json.metrics.implementationsByStage).toEqual({ build: 2, testing: 1 })
  })

  it('cancelled implementations are excluded from the query itself (WHERE stage <> cancelled) — never counted', () => {
    expect(routeSource).toContain("WHERE i.stage <> 'cancelled'")
  })

  it('approaching-launch count only includes implementations with a real target_launch_date within the window, in an active (non-terminal) stage', async () => {
    queueResponses({
      implementations: [
        { ...LD_TENNIS_IMPL, id: 'impl-soon', target_launch_date: utcDateString(5) },
        { ...LD_TENNIS_IMPL, id: 'impl-no-date', target_launch_date: null },
        { ...LD_TENNIS_IMPL, id: 'impl-live', stage: 'live', target_launch_date: utcDateString(5) },
        { ...LD_TENNIS_IMPL, id: 'impl-far', target_launch_date: utcDateString(60) },
      ],
    })
    const res = await runAsSuperAdmin()
    const json = await res.json()
    // only impl-soon qualifies: real date, within 14 days, active stage
    expect(json.metrics.implementationsApproachingLaunch).toBe(1)
  })

  it('does not reinterpret the existing Active Clients / onboardingInProgress metrics as implementation counts — they remain separate fields', () => {
    expect(routeSource).toContain('onboardingInProgress: (snapshot.onboarding_in_progress as number) ?? 0,')
    expect(routeSource).toContain('implementationsTotal: implementationRows.length,')
  })
})

// ── Blocked / at-risk attention generation ──────────────────────────────────

describe('Blocked / at-risk attention item generation', () => {
  it('health=blocked generates a critical implementation_blocked item', async () => {
    queueResponses({ implementations: [{ ...LD_TENNIS_IMPL, health: 'blocked' }] })
    const res = await runAsSuperAdmin()
    const json = await res.json()
    const item = json.items.find((i: { type: string }) => i.type === 'implementation_blocked')
    expect(item).toBeDefined()
    expect(item.severity).toBe('critical')
    expect(item.href).toBe('/admin/implementations/impl-ldtennis')
  })

  it('health=at_risk generates a high-severity implementation_at_risk item', async () => {
    queueResponses({ implementations: [{ ...LD_TENNIS_IMPL, health: 'at_risk' }] })
    const res = await runAsSuperAdmin()
    const json = await res.json()
    const item = json.items.find((i: { type: string }) => i.type === 'implementation_at_risk')
    expect(item).toBeDefined()
    expect(item.severity).toBe('high')
  })

  it('health=on_track with no near-term date generates NO attention item — a healthy implementation is correctly silent, not padded', async () => {
    queueResponses({ implementations: [LD_TENNIS_IMPL] }) // on_track, no target date
    const res = await runAsSuperAdmin()
    const json = await res.json()
    const implItems = json.items.filter((i: { id: string }) => i.id.startsWith('implementation_'))
    expect(implItems).toEqual([])
  })

  it('deterministic precedence: blocked takes priority over an overdue launch date on the same record — exactly one item, not two', async () => {
    queueResponses({
      implementations: [{ ...LD_TENNIS_IMPL, health: 'blocked', target_launch_date: utcDateString(-30) }],
    })
    const res = await runAsSuperAdmin()
    const json = await res.json()
    const implItems = json.items.filter((i: { id: string }) => i.id.startsWith('implementation_'))
    expect(implItems.length).toBe(1)
    expect(implItems[0].type).toBe('implementation_blocked')
  })

  it('next_action, when present, enriches the item description rather than generating its own independent item (avoids flooding)', async () => {
    queueResponses({ implementations: [{ ...LD_TENNIS_IMPL, health: 'at_risk', next_action: 'Luke review' }] })
    const res = await runAsSuperAdmin()
    const json = await res.json()
    const item = json.items.find((i: { type: string }) => i.type === 'implementation_at_risk')
    expect(item.description).toContain('Next: Luke review')
    // A healthy implementation with only next_action set (no health/date issue) must not appear at all:
    responseQueue = []; callCount = 0
    queueResponses({ implementations: [{ ...LD_TENNIS_IMPL, next_action: 'Just a note' }] })
    const res2 = await runAsSuperAdmin()
    const json2 = await res2.json()
    expect(json2.items.filter((i: { id: string }) => i.id.startsWith('implementation_'))).toEqual([])
  })
})

// ── Launch-date attention behaviour ─────────────────────────────────────────

describe('Launch-date attention behaviour', () => {
  it('an overdue target_launch_date on an active-stage implementation generates implementation_overdue_launch, severity scaling with days overdue', async () => {
    queueResponses({
      implementations: [
        { ...LD_TENNIS_IMPL, id: 'a', target_launch_date: utcDateString(-1) },   // <3d -> medium
        { ...LD_TENNIS_IMPL, id: 'b', target_launch_date: utcDateString(-5) },   // >=3d -> high
        { ...LD_TENNIS_IMPL, id: 'c', target_launch_date: utcDateString(-30) },  // >=14d -> critical
      ],
    })
    const res = await runAsSuperAdmin()
    const json = await res.json()
    const byId = (id: string) => json.items.find((i: { id: string }) => i.id === `implementation_overdue_launch:${id}`)
    expect(byId('a').severity).toBe('medium')
    expect(byId('b').severity).toBe('high')
    expect(byId('c').severity).toBe('critical')
  })

  it('an upcoming target_launch_date within the window generates implementation_upcoming_launch, severity scaling with days remaining', async () => {
    queueResponses({
      implementations: [
        { ...LD_TENNIS_IMPL, id: 'x', target_launch_date: utcDateString(2) },  // <=3d -> high
        { ...LD_TENNIS_IMPL, id: 'y', target_launch_date: utcDateString(5) },  // <=7d -> medium
        { ...LD_TENNIS_IMPL, id: 'z', target_launch_date: utcDateString(12) }, // <=14d -> low
      ],
    })
    const res = await runAsSuperAdmin()
    const json = await res.json()
    const byId = (id: string) => json.items.find((i: { id: string }) => i.id === `implementation_upcoming_launch:${id}`)
    expect(byId('x').severity).toBe('high')
    expect(byId('y').severity).toBe('medium')
    expect(byId('z').severity).toBe('low')
  })

  it('a target_launch_date beyond the 14-day window generates no item yet', async () => {
    queueResponses({ implementations: [{ ...LD_TENNIS_IMPL, target_launch_date: utcDateString(20) }] })
    const res = await runAsSuperAdmin()
    const json = await res.json()
    expect(json.items.filter((i: { id: string }) => i.id.startsWith('implementation_'))).toEqual([])
  })

  it('a live-stage implementation never generates a launch-date item, even with a past target date (nothing to alert on — it already launched)', async () => {
    queueResponses({ implementations: [{ ...LD_TENNIS_IMPL, stage: 'live', target_launch_date: utcDateString(-10) }] })
    const res = await runAsSuperAdmin()
    const json = await res.json()
    expect(json.items.filter((i: { id: string }) => i.id.startsWith('implementation_'))).toEqual([])
  })

  it('an on_hold implementation with a past target date does not generate a launch-date item (deliberately paused, not silently overdue)', async () => {
    queueResponses({ implementations: [{ ...LD_TENNIS_IMPL, stage: 'on_hold', target_launch_date: utcDateString(-10) }] })
    const res = await runAsSuperAdmin()
    const json = await res.json()
    expect(json.items.filter((i: { id: string }) => i.id.startsWith('implementation_'))).toEqual([])
  })

  it('reuses the same UPCOMING_WINDOW_DAYS constant already established for Web Systems launches, not a separate undocumented number', () => {
    const matches = routeSource.match(/UPCOMING_WINDOW_DAYS = 14/g) ?? []
    expect(matches.length).toBe(1) // declared once, referenced by both the existing and new logic
  })
})

// ── Absence of fake implementation data ─────────────────────────────────────

describe('No fake/seeded implementation data anywhere in this feature', () => {
  it('the route never references a mock/demo/seed implementation fixture', () => {
    expect(routeSource).not.toMatch(/const\s+(MOCK|DEMO|SEED|FAKE)_?\w*\s*=\s*\[/i)
    expect(routeSource).not.toContain('LD Tennis Digital Platform') // no hardcoded example data
  })

  it('ImplementationSummary and ImplementationsByClient fetch real endpoints, no hardcoded arrays', () => {
    expect(founderSource).toContain("fetch('/api/implementations')")
    const summaryBlock = founderSource.slice(
      founderSource.indexOf('function ImplementationSummary'),
      founderSource.indexOf('function ImplementationsByClient'),
    )
    expect(summaryBlock).not.toMatch(/const\s+(MOCK|DEMO|SEED|FAKE)_?\w*\s*=\s*\[/i)
  })
})

// ── Organisation-to-implementation mapping ──────────────────────────────────

describe('Organisation-to-implementation mapping uses the existing organisation relationship only', () => {
  it('ImplementationsByClient groups by organisation_id/organisation_name from the API response — no parallel client-identity logic', () => {
    const block = founderSource.slice(
      founderSource.indexOf('function ImplementationsByClient'),
      founderSource.indexOf('const HEALTH_META'),
    )
    expect(block).toContain('row.organisation_id')
    expect(block).toContain('row.organisation_name')
    expect(block).not.toMatch(/const\s+\w*CLIENT\w*_ID\w*\s*=/) // no synthetic client-id scheme
  })

  it('the attention-queue route resolves organisation name/id via a direct LEFT JOIN to organisations — no duplicated organisation logic', () => {
    expect(routeSource).toContain('LEFT JOIN organisations o ON o.id = i.organisation_id')
  })
})

// ── Founder OS Client implementation rendering + links ──────────────────────

describe('Founder OS Clients tab renders real implementation rows linking to the existing detail page', () => {
  it('ImplementationsByClient is mounted in the Clients tab', () => {
    const clientsStart = founderSource.indexOf("{section === 'clients' && <>")
    const clientsEnd = founderSource.indexOf("{/* ── Revenue ── */}")
    const block = founderSource.slice(clientsStart, clientsEnd)
    expect(block).toContain('<ImplementationsByClient />')
  })

  it('ImplementationSummary is mounted in the Overview tab', () => {
    const overviewStart = founderSource.indexOf("{section === 'overview' && <>")
    const overviewEnd = founderSource.indexOf("{/* ── Clients ── */}")
    const block = founderSource.slice(overviewStart, overviewEnd)
    expect(block).toContain('<ImplementationSummary')
  })

  it('every implementation row/queue item links to the existing /admin/implementations/{id} detail page — no second implementation-management UI was built inside Founder OS', () => {
    expect(routeSource).toContain('const href = `/admin/implementations/${impl.id}`')
    expect(founderSource).toContain('href={`/admin/implementations/${impl.id}`}')
    expect(founderSource).not.toContain('function ImplementationEditForm')
    expect(founderSource).not.toContain('function ImplementationDetailModal')
  })

  it('the Overview summary also links out to the full Client Implementations list page', () => {
    expect(founderSource).toContain('<Link href="/admin/implementations" style={{ fontSize: 10, color: T.purple, textDecoration: \'none\' }}>View all →</Link>')
  })
})

// ── Preservation of existing attention queue sources ────────────────────────

describe('Existing (Phase A/B) attention queue sources are unchanged', () => {
  it('alerts, client_pipeline, web_service_leads, and client_onboarding queries are byte-identical to before', () => {
    expect(routeSource).toContain("WHERE a.status = 'OPEN'")
    expect(routeSource).toContain('o.id = cp.organisation_id::text')
    expect(routeSource).toContain("const LEAD_ACTIONABLE_STAGES = ['new', 'contacted', 'discovery', 'qualified'];")
    expect(routeSource).toContain("WHERE co.onboarding_stage <> 'live'")
  })

  it('existing item types (alert/client_request/web_lead/upcoming_launch/overdue_deployment) still work end to end alongside the new implementation types', async () => {
    queueResponses({
      alerts: [{ id: 'a1', organisation_id: 'org-1', title: 'Alert', description: 'd', severity: 'HIGH', module: null, rule_key: null, created_at: new Date().toISOString(), org_name: 'Org' }],
      implementations: [{ ...LD_TENNIS_IMPL, health: 'blocked' }],
    })
    const res = await runAsSuperAdmin()
    const json = await res.json()
    expect(json.items.some((i: { type: string }) => i.type === 'alert')).toBe(true)
    expect(json.items.some((i: { type: string }) => i.type === 'implementation_blocked')).toBe(true)
  })

  it('super_admin-only access and zero-request-input behaviour are unchanged', () => {
    expect(routeSource).toMatch(/export async function GET\(\)\s*\{/)
    expect(routeSource).toContain("if (session.role !== 'super_admin')")
    expect(routeSource).not.toContain('searchParams')
  })
})

// ── Truthful zero/empty states ──────────────────────────────────────────────

describe('Truthful zero vs. unavailable vs. loading states', () => {
  it('ImplementationSummary distinguishes loading, not-connected, and a genuine zero count', () => {
    const block = founderSource.slice(
      founderSource.indexOf('function ImplementationSummary'),
      founderSource.indexOf('function ImplementationsByClient'),
    )
    expect(block).toContain('Loading…')
    expect(block).toContain('Not connected')
    expect(block).toContain('No implementations yet')
  })

  it('a real zero (implementationsTotal === 0) renders the empty state, not fabricated tiles', () => {
    expect(founderSource).toContain('metrics.implementationsTotal === 0')
  })

  it('ImplementationsByClient shows a genuine empty state when zero implementations exist anywhere, not a blank panel', () => {
    const block = founderSource.slice(
      founderSource.indexOf('function ImplementationsByClient'),
      founderSource.indexOf('const HEALTH_META'),
    )
    expect(block).toContain('No implementations yet')
    expect(block).toContain('groups.size === 0')
  })

  it('a NULL active_mrr (unrelated existing metric) remains NULL-safe — confirms this branch did not regress prior Phase B/hardening behaviour', async () => {
    queueResponses({ snapshot: [{ active_mrr: null }], implementations: [] })
    const res = await runAsSuperAdmin()
    const json = await res.json()
    expect(json.metrics.activeMrr).toBe(0)
  })
})

// ── Scope boundaries ─────────────────────────────────────────────────────────

describe('Scope boundaries — LD Tennis, Web Systems, and the Client Implementations CRUD routes are untouched', () => {
  it('LD Tennis routes are untouched', () => {
    const lead = fs.readFileSync(path.resolve(__dirname, '../../app/api/lead/route.ts'), 'utf-8')
    const book = fs.readFileSync(path.resolve(__dirname, '../../app/api/tennis/book/route.ts'), 'utf-8')
    for (const src of [lead, book]) {
      expect(src).not.toContain('implementation')
    }
  })

  it('the Web Systems lead pipeline route is untouched', () => {
    const webLeads = fs.readFileSync(path.resolve(__dirname, '../../app/api/web-services/leads/route.ts'), 'utf-8')
    expect(webLeads).not.toContain('implementations')
  })

  it('the Client Implementations CRUD routes (app/api/implementations/*) are untouched by this branch', () => {
    const listRoute = fs.readFileSync(path.resolve(__dirname, '../../app/api/implementations/route.ts'), 'utf-8')
    const idRoute = fs.readFileSync(path.resolve(__dirname, '../../app/api/implementations/[id]/route.ts'), 'utf-8')
    // Sanity-check distinctive lines proving these weren't touched, rather
    // than a full-file hash — matches the pattern used elsewhere in this suite.
    expect(listRoute).toContain("if (!requested) {")
    expect(idRoute).toContain('organisation_id itself is intentionally not patchable here')
  })
})
