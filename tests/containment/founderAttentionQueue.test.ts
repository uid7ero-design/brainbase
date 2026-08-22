import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// ── GET /api/founder/attention-queue — mocked auth + sql ────────────────────

const getAuthSessionMock = vi.fn()
vi.mock('@/lib/authSession', () => ({
  getAuthSession: (...args: unknown[]) => getAuthSessionMock(...args),
}))

// The route fires exactly 6 sql`` calls, always in the same literal order
// (alerts, requests, leads, onboarding, lead-stage-counts, snapshot) — no
// branching precedes them, so a positional queue is a faithful, robust stand-in
// for a real Postgres connection without needing to parse query text.
let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const { GET } = await import('@/app/api/founder/attention-queue/route')

const ROUTE_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/founder/attention-queue/route.ts'),
  'utf-8',
)
const OPS_ALERTS_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/ops/alerts/route.ts'),
  'utf-8',
)

// UTC-anchored date arithmetic — avoids local-timezone flakiness near day
// boundaries, matching the route's own UTC-anchored 'today' (see route.ts).
function utcDateString(offsetDays: number): string {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays))
  return d.toISOString().slice(0, 10)
}

function queueResponses(alerts: unknown[], requests: unknown[], leads: unknown[], onboarding: unknown[], leadStages: unknown[], snapshot: unknown[]) {
  responseQueue = [alerts, requests, leads, onboarding, leadStages, snapshot]
  callCount = 0
}

beforeEach(() => {
  getAuthSessionMock.mockReset()
  sqlMock.mockClear()
  responseQueue = []
  callCount = 0
})

// ── 1/2. Auth gating ─────────────────────────────────────────────────────────

describe('GET /api/founder/attention-queue — auth gating', () => {
  it('returns 401 when there is no valid session', async () => {
    getAuthSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns 403 for a non-super_admin session (admin)', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-1', userId: 'u1' })
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns 403 for a non-super_admin session (viewer)', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'viewer', organisationId: 'org-1', userId: 'u1' })
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('does not touch the database at all for a rejected caller (no cross-org leak on auth failure)', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-1', userId: 'u1' })
    await GET()
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('succeeds (200) for a super_admin session', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'super_admin', organisationId: 'org-brainbase', userId: 'u1' })
    queueResponses([], [], [], [], [], [{}])
    const res = await GET()
    expect(res.status).toBe(200)
  })
})

// ── 3. No browser-supplied organisation_id can widen scope ──────────────────

describe('Browser-supplied organisation IDs cannot widen scope', () => {
  it('GET takes no request/params — there is no channel for a client-supplied org filter', () => {
    expect(ROUTE_SOURCE).toMatch(/export async function GET\(\)\s*\{/)
  })

  it('the route never reads searchParams, a request body, or a client-supplied organisationId', () => {
    expect(ROUTE_SOURCE).not.toContain('searchParams')
    expect(ROUTE_SOURCE).not.toContain('req.json')
    expect(ROUTE_SOURCE).not.toContain('request.json')
  })

  it('cross-org scope is derived only from session.role, never session.organisationId', () => {
    expect(ROUTE_SOURCE).not.toContain('session.organisationId')
  })
})

// ── 4/5/6/7/8/9/10 — SQL predicates (verified further via disposable Postgres,
// not re-run here; these assert the exact predicates that were validated) ────

describe('SQL predicates', () => {
  it('alerts: OPEN only, no RESOLVED/ACKNOWLEDGED branch', () => {
    expect(ROUTE_SOURCE).toContain("WHERE a.status = 'OPEN'")
    expect(ROUTE_SOURCE).not.toContain('RESOLVED')
    expect(ROUTE_SOURCE).not.toContain('ACKNOWLEDGED')
  })

  it('requests: only new/in_progress are actionable, resolved/awaiting_client excluded', () => {
    expect(ROUTE_SOURCE).toContain("const REQUEST_ACTIONABLE_STATUSES = ['new', 'in_progress'];")
  })

  it('requests: explicitly casts client_pipeline.organisation_id to text before joining organisations (the UUID/TEXT drift fix)', () => {
    expect(ROUTE_SOURCE).toContain('o.id = cp.organisation_id::text')
  })

  it('leads: actionable early stages match the verified 12-value status set, minus later stages', () => {
    expect(ROUTE_SOURCE).toContain("const LEAD_ACTIONABLE_STAGES = ['new', 'contacted', 'discovery', 'qualified'];")
  })

  it('onboarding: excludes live records and requires a target_launch_date', () => {
    expect(ROUTE_SOURCE).toContain("WHERE co.onboarding_stage <> 'live'")
    expect(ROUTE_SOURCE).toContain('co.target_launch_date IS NOT NULL')
  })

  it('upcoming window is bounded to 14 days; overdue has no lower bound (any distance in the past)', () => {
    expect(ROUTE_SOURCE).toContain('const UPCOMING_WINDOW_DAYS = 14;')
    expect(ROUTE_SOURCE).toContain('days < 0')
  })

  it('MRR sums only active managed_services rows', () => {
    expect(ROUTE_SOURCE).toMatch(/SUM\(monthly_value\)[\s\S]{0,20}FROM managed_services WHERE status = 'active'/)
  })

  it('MRR is NULL-safe via COALESCE', () => {
    expect(ROUTE_SOURCE).toContain('COALESCE(SUM(monthly_value), 0)')
  })
})

// ── Functional: response shaping (severity mapping, sort, day-math, NULL-safety) ─

describe('Response shaping — functional', () => {
  beforeEach(() => {
    getAuthSessionMock.mockResolvedValue({ role: 'super_admin', organisationId: 'org-brainbase', userId: 'u1' })
  })

  it('maps alert severities, excludes items whose join found no organisation name from having an organisationId, and produces a /clients href only when matched', async () => {
    queueResponses(
      [
        { id: 'a1', organisation_id: 'org-1', title: 'Crit', description: 'd', severity: 'CRITICAL', module: null, rule_key: null, created_at: '2026-08-20T00:00:00Z', org_name: 'Downtown 11' },
        { id: 'a2', organisation_id: 'org-orphan', title: 'Orphan', description: 'd', severity: 'LOW', module: null, rule_key: null, created_at: '2026-08-20T00:00:00Z', org_name: null },
      ],
      [], [], [], [], [{}],
    )
    const res = await GET()
    const json = await res.json()
    const crit = json.items.find((i: { id: string }) => i.id === 'alert:a1')
    const orphan = json.items.find((i: { id: string }) => i.id === 'alert:a2')
    expect(crit.severity).toBe('critical')
    expect(crit.href).toBe('/clients/org-1')
    expect(orphan.organisationId).toBeNull()
    expect(orphan.href).toBe('/admin/founder')
  })

  it('sorts combined items by severity rank (critical/high/medium/low) regardless of source type', async () => {
    queueResponses(
      [{ id: 'a1', organisation_id: 'org-1', title: 'Low alert', description: '', severity: 'LOW', module: null, rule_key: null, created_at: '2026-08-01T00:00:00Z', org_name: 'Org' }],
      [{ id: 'r1', organisation_id: 'uuid-1', type: 'issue', title: 'High request', description: '', status: 'new', priority: 'high', created_at: '2026-08-10T00:00:00Z', org_name: 'Org' }],
      [{ id: 'l1', full_name: 'Lead', business_name: null, status: 'new', priority: 'high', score: 5, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-15T00:00:00Z' }],
      [], [], [{}],
    )
    const res = await GET()
    const json = await res.json()
    const severities = json.items.map((i: { severity: string }) => i.severity)
    expect(severities[0]).toBe('high')
    expect(severities[severities.length - 1]).toBe('low')
  })

  it('bifurcates client_onboarding rows into overdue (past target date) vs upcoming (future, within window)', async () => {
    const past = utcDateString(-20)
    const future = utcDateString(5)
    queueResponses([], [], [],
      [
        { id: 'o1', organisation_id: null, client_name: 'Overdue Co', onboarding_stage: 'build', target_launch_date: past, org_name: null, lead_name: null, lead_business_name: null },
        { id: 'o2', organisation_id: null, client_name: 'Upcoming Co', onboarding_stage: 'review', target_launch_date: future, org_name: null, lead_name: null, lead_business_name: null },
      ],
      [], [{}],
    )
    const res = await GET()
    const json = await res.json()
    const overdue = json.items.find((i: { id: string }) => i.id === 'overdue_deployment:o1')
    const upcoming = json.items.find((i: { id: string }) => i.id === 'upcoming_launch:o2')
    expect(overdue).toBeDefined()
    expect(overdue.metadata.daysOverdue).toBeGreaterThanOrEqual(19)
    expect(overdue.severity).toBe('critical') // >=14 days overdue
    expect(upcoming).toBeDefined()
    expect(upcoming.metadata.daysUntil).toBeGreaterThanOrEqual(4)
    expect(upcoming.severity).toBe('medium') // 5 days out: >3 and <=7 -> medium
  })

  it('overdue severity escalates with staleness: <3d medium-ish, >=3d high, >=14d critical', async () => {
    queueResponses([], [], [],
      [
        { id: 'o1', organisation_id: null, client_name: 'A', onboarding_stage: 'build', target_launch_date: utcDateString(-1), org_name: null, lead_name: null, lead_business_name: null },
        { id: 'o2', organisation_id: null, client_name: 'B', onboarding_stage: 'build', target_launch_date: utcDateString(-5), org_name: null, lead_name: null, lead_business_name: null },
        { id: 'o3', organisation_id: null, client_name: 'C', onboarding_stage: 'build', target_launch_date: utcDateString(-30), org_name: null, lead_name: null, lead_business_name: null },
      ],
      [], [{}],
    )
    const res = await GET()
    const json = await res.json()
    const byId = (id: string) => json.items.find((i: { id: string }) => i.id === id)
    expect(byId('overdue_deployment:o1').severity).toBe('medium')
    expect(byId('overdue_deployment:o2').severity).toBe('high')
    expect(byId('overdue_deployment:o3').severity).toBe('critical')
  })

  it('handles a NULL active_mrr from the DB safely (no NaN, defaults to 0)', async () => {
    queueResponses([], [], [], [], [], [{
      open_alerts: 0, open_requests: 0, onboarding_in_progress: 0,
      active_managed_services: 2, active_mrr: null,
    }])
    const res = await GET()
    const json = await res.json()
    expect(json.metrics.activeMrr).toBe(0)
    expect(Number.isNaN(json.metrics.activeMrr)).toBe(false)
  })

  it('passes through a real active_mrr value unchanged', async () => {
    queueResponses([], [], [], [], [], [{
      open_alerts: 3, open_requests: 1, onboarding_in_progress: 2,
      active_managed_services: 4, active_mrr: 1780.5,
    }])
    const res = await GET()
    const json = await res.json()
    expect(json.metrics.activeMrr).toBe(1780.5)
    expect(json.metrics.openAlerts).toBe(3)
    expect(json.metrics.activeManagedServices).toBe(4)
  })

  it('builds leadsByStage from the grouped count rows', async () => {
    queueResponses([], [], [], [],
      [{ status: 'new', count: 3 }, { status: 'contacted', count: 1 }],
      [{}],
    )
    const res = await GET()
    const json = await res.json()
    expect(json.metrics.leadsByStage).toEqual({ new: 3, contacted: 1 })
  })
})

// ── 11. Founder OS no longer uses the QUEUE mock for the Overview queue ─────

describe('app/admin/founder/page.tsx — Overview tab uses the real attention queue', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app/admin/founder/page.tsx'), 'utf-8')

  function overviewBlock(): string {
    const start = source.indexOf("{section === 'overview' && <>")
    const end = source.indexOf("{/* ── Clients ── */}")
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    return source.slice(start, end)
  }

  it('the Overview attention queue is <RealFounderOperations />, not the QUEUE-backed <AttentionQueue>', () => {
    const block = overviewBlock()
    expect(block).toContain('<RealFounderOperations />')
    expect(block).not.toMatch(/<AttentionQueue\s+items=\{queueItems\}/)
  })

  it('RealFounderOperations fetches the new local endpoint, not the external founder-* proxy', () => {
    expect(source).toContain("fetch('/api/founder/attention-queue')")
  })

  it('the Clients-tab mini-queue (out of Phase A scope) is untouched and still uses queueItems', () => {
    const clientsStart = source.indexOf("{/* ── Clients ── */}")
    const clientsEnd = source.indexOf("{/* ── Revenue ── */}")
    const block = source.slice(clientsStart, clientsEnd)
    expect(block).toMatch(/<AttentionQueue\s+/)
    expect(block).toContain('items={queueItems.filter')
  })

  it('does not present a mock number as real inside the new snapshot — every SnapshotTile value comes from the metrics state, not a mock constant', () => {
    const snapshotBlock = source.slice(
      source.indexOf('Real operational snapshot'),
      source.indexOf('Real operational snapshot') + 900,
    )
    expect(snapshotBlock).not.toMatch(/KPI_TILES|MRR_POINTS/)
    expect(snapshotBlock).toContain('metrics.activeMrr')
  })
})

// ── 12. /api/ops/alerts org-scoped behaviour is unchanged ───────────────────

describe('Phase A does not alter /api/ops/alerts org-scoped behaviour', () => {
  it('GET /api/ops/alerts still scopes to the caller session organisation only', () => {
    expect(OPS_ALERTS_SOURCE).toContain('WHERE organisation_id = ${organisationId}')
    expect(OPS_ALERTS_SOURCE).toContain('session.organisationId')
  })

  it('the new founder attention-queue route is a separate file — /api/ops/alerts was not modified to add cross-org logic', () => {
    expect(OPS_ALERTS_SOURCE).not.toContain('attention-queue')
    expect(OPS_ALERTS_SOURCE).not.toMatch(/LEFT JOIN organisations/)
  })
})

// ── 13. LD Tennis protected surfaces untouched ───────────────────────────────

describe('Scope boundaries — LD Tennis is untouched by Founder OS Phase A', () => {
  it('LD Tennis routes do not reference the new founder attention-queue endpoint', () => {
    const lead = fs.readFileSync(path.resolve(__dirname, '../../app/api/lead/route.ts'), 'utf-8')
    const leadsId = fs.readFileSync(path.resolve(__dirname, '../../app/api/leads/[id]/route.ts'), 'utf-8')
    const book = fs.readFileSync(path.resolve(__dirname, '../../app/api/tennis/book/route.ts'), 'utf-8')
    for (const src of [lead, leadsId, book]) {
      expect(src).not.toContain('attention-queue')
      expect(src).not.toContain('RealFounderOperations')
    }
  })

  it('the attention-queue route never queries tennis_leads or tennis_lead_messages', () => {
    expect(ROUTE_SOURCE).not.toContain('tennis_leads')
    expect(ROUTE_SOURCE).not.toContain('tennis_lead_messages')
  })
})
