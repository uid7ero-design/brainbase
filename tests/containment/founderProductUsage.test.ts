import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Founder OS Phase E.3 — real Product Usage signals.
//
// PRE-MERGE CORRECTION: a read-only Neon introspection query proved
// social_insights and saved_briefings do not exist in the real deployed
// database (their CREATE TABLE statements declare organisation_id as
// UUID referencing organisations(id), but organisations.id is genuinely
// TEXT there — a UUID column cannot have a foreign key to a TEXT column,
// so those two CREATE TABLE statements never succeeded in Production).
// Querying them caused every GET /api/founder/usage request to fail in
// the deployed preview. Both were permanently removed from
// lib/founder/usageSignals.ts, with no substitute metric added — this
// file was updated accordingly, not weakened.
//
// Scoped to the two sources confirmed by that same introspection to
// exist with organisation_id genuinely typed TEXT: uploaded_files,
// organiser_item_updates. integrations/sync_jobs/agent_runs do not
// exist in Production; users.last_seen_at does not exist; users.
// last_login_at is unpopulated for all 5 Production users — none of
// those are queried anywhere in this change. organiser_items (as
// opposed to organiser_item_updates) is deliberately never queried:
// bulk CSV import can create many organiser_items from one user action
// with no distinguishing marker. Active organisations/users, general AI
// usage, task completions, bookings, dashboard activity, trends, and
// percentages remain explicitly excluded from V1.

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

function sqlCallArgs(index: number): unknown[] {
  return sqlMock.mock.calls[index] as unknown as unknown[]
}

const { GET } = await import('@/app/api/founder/usage/route')
const { getProductUsage } = await import('@/lib/founder/usageSignals')

const ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/usage/route.ts'), 'utf-8')
const SIGNALS_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../lib/founder/usageSignals.ts'), 'utf-8')
const FOUNDER_PAGE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/admin/founder/page.tsx'), 'utf-8')
const SYSTEM_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/system/route.ts'), 'utf-8')
const ATTN_QUEUE_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/attention-queue/route.ts'), 'utf-8')
const ORGANISER_PAGE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/organiser/page.tsx'), 'utf-8')
const COMMAND_PAGE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/command/page.tsx'), 'utf-8')

// Scoped to executable code, not this file's/the source's own explanatory
// prose (both new files legitimately name integrations/sync_jobs/
// agent_runs/last_seen_at/last_login_at/organiser_items/social_insights/
// saved_briefings while explaining why they are NOT used) — same
// established pattern as founderSystemHealth.test.ts / founderTasks.
// test.ts.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}
const ROUTE_EXECUTABLE = stripComments(ROUTE_SOURCE)
const SIGNALS_EXECUTABLE = stripComments(SIGNALS_SOURCE)

const SUPER_ADMIN = { role: 'super_admin', organisationId: 'org-caller', userId: 'u1' }
const BRAINBASE_ORG_ID = '11111111-1111-1111-1111-111111111111'
const ORG_ROW = [{ id: BRAINBASE_ORG_ID }]

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

beforeEach(() => {
  getAuthSessionMock.mockReset()
  sqlMock.mockClear()
  responseQueue = []
  callCount = 0
})

// ── AUTH ─────────────────────────────────────────────────────────────────

describe('GET /api/founder/usage — access gating', () => {
  it('401 with no session, 403 for a non-super_admin session, no sql calls in either case', async () => {
    getAuthSessionMock.mockRejectedValue(new Error('Unauthorized'))
    expect((await GET()).status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-1', userId: 'u1' })
    expect((await GET()).status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('200 for a super_admin session, only after auth succeeds (test 15: super_admin auth enforced)', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    queue(ORG_ROW, [{ count: 0 }], [{ count: 0 }])
    const res = await GET()
    expect(res.status).toBe(200)
  })
})

// ── SOURCE TRUTH ─────────────────────────────────────────────────────────

describe('Only the two Production-confirmed sources are used (tests 1-4)', () => {
  it('test 1: uses uploaded_files', () => {
    expect(SIGNALS_SOURCE).toContain('FROM uploaded_files')
  })

  it('test 2: uses organiser_item_updates', () => {
    expect(SIGNALS_SOURCE).toContain('FROM organiser_item_updates')
  })

  it('test 3: social_insights is absent from executable E.3 code', () => {
    expect(SIGNALS_EXECUTABLE).not.toContain('social_insights')
    expect(ROUTE_EXECUTABLE).not.toContain('social_insights')
  })

  it('test 4: saved_briefings is absent from executable E.3 code', () => {
    expect(SIGNALS_EXECUTABLE).not.toContain('saved_briefings')
    expect(ROUTE_EXECUTABLE).not.toContain('saved_briefings')
  })

  it('never references integrations, sync_jobs, or agent_runs in executable code', () => {
    for (const src of [ROUTE_EXECUTABLE, SIGNALS_EXECUTABLE]) {
      expect(src).not.toContain('integrations')
      expect(src).not.toContain('sync_jobs')
      expect(src).not.toContain('agent_runs')
    }
  })

  it('never references users.last_seen_at or users.last_login_at in executable code', () => {
    for (const src of [ROUTE_EXECUTABLE, SIGNALS_EXECUTABLE]) {
      expect(src).not.toContain('last_seen_at')
      expect(src).not.toContain('last_login_at')
    }
  })

  it('never queries organiser_items (as opposed to organiser_item_updates) — a naive substring check would false-positive on the valid table name, so this asserts the specific "FROM organiser_items" token is absent while "FROM organiser_item_updates" remains present', () => {
    expect(SIGNALS_EXECUTABLE).not.toMatch(/FROM organiser_items\b/)
    expect(SIGNALS_EXECUTABLE).toContain('FROM organiser_item_updates')
  })

  it('functional: getProductUsage() now makes exactly 3 sql calls (org resolve + 2 metrics), touching only the two approved tables', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    queue(ORG_ROW, [{ count: 1 }], [{ count: 2 }])
    await GET()
    expect(sqlMock).toHaveBeenCalledTimes(3)
    const allCallStrings = sqlMock.mock.calls
      .map((_, i) => (sqlCallArgs(i)[0] as TemplateStringsArray).join(''))
      .join('\n')
    expect(allCallStrings).not.toMatch(/\bintegrations\b|\bsync_jobs\b|\bagent_runs\b|last_seen_at|last_login_at|social_insights|saved_briefings/)
    expect(allCallStrings).not.toMatch(/FROM organiser_items\b/)
  })
})

// ── UPLOADS ──────────────────────────────────────────────────────────────

describe('Uploads (test 5: demo-seed exclusion; test 6: BrainBase-org exclusion; test 7: 30-day window)', () => {
  it('30-day window, demo-seed.csv exclusion, and BrainBase-org exclusion are present in source', () => {
    const start = SIGNALS_SOURCE.indexOf('FROM uploaded_files')
    const end = SIGNALS_SOURCE.indexOf('`,', start)
    const block = SIGNALS_SOURCE.slice(start, end)
    expect(block).toContain("INTERVAL '30 days'")
    expect(block).toContain("file_name <> 'demo-seed.csv'")
    expect(block).toContain('organisation_id <> ${brainbaseOrgId}')
  })

  it('the comparison is plain TEXT (no ::uuid cast) — matches the confirmed real column type', () => {
    const start = SIGNALS_SOURCE.indexOf('FROM uploaded_files')
    const end = SIGNALS_SOURCE.indexOf('`,', start)
    const block = SIGNALS_SOURCE.slice(start, end)
    expect(block).not.toContain('::uuid')
  })

  it('functional: resolves the count returned by the query', async () => {
    queue(ORG_ROW, [{ count: 7 }], [{ count: 0 }])
    const usage = await getProductUsage()
    expect(usage.uploads).toBe(7)
  })

  it('the API response never includes a filename or any per-row field', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    queue(ORG_ROW, [{ count: 1 }], [{ count: 0 }])
    const res = await GET()
    const json = await res.json()
    expect(JSON.stringify(json)).not.toMatch(/file_name|\.csv|uploaded_by/)
  })
})

// ── ORGANISER ────────────────────────────────────────────────────────────

describe('Organiser updates (test 6: BrainBase-org exclusion; test 7: 30-day window)', () => {
  it('organiser_item_updates is used, organiser_items is not, BrainBase org is excluded', () => {
    const start = SIGNALS_SOURCE.indexOf('FROM organiser_item_updates')
    const end = SIGNALS_SOURCE.indexOf('`,', start)
    const block = SIGNALS_SOURCE.slice(start, end)
    expect(block).toContain("INTERVAL '30 days'")
    expect(block).toContain('organisation_id <> ${brainbaseOrgId}')
    expect(block).not.toContain('organiser_items ')
    expect(block).not.toContain('::uuid')
  })

  it('functional: resolves the count returned by the query', async () => {
    queue(ORG_ROW, [{ count: 0 }], [{ count: 5 }])
    const usage = await getProductUsage()
    expect(usage.organiserUpdates).toBe(5)
  })

  it('the API response never includes author_name or comment body content', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    queue(ORG_ROW, [{ count: 0 }], [{ count: 1 }])
    const res = await GET()
    const json = await res.json()
    expect(JSON.stringify(json)).not.toMatch(/author_name|body/)
  })
})

// ── REMOVED METRICS ──────────────────────────────────────────────────────

describe('Social analyses / Briefings generated are fully removed, not replaced', () => {
  it('ProductUsageAggregate no longer has socialAnalyses/briefingsGenerated fields', () => {
    expect(SIGNALS_SOURCE).not.toContain('socialAnalyses')
    expect(SIGNALS_SOURCE).not.toContain('briefingsGenerated')
  })

  it('the UI no longer renders "Social analyses" (test 12)', () => {
    expect(FOUNDER_PAGE_SOURCE).not.toContain("'Social analyses'")
  })

  it('the UI no longer renders "Briefings generated" (test 13)', () => {
    expect(FOUNDER_PAGE_SOURCE).not.toContain("'Briefings generated'")
  })

  it('no substitute/speculative metric was introduced in their place', () => {
    const start = FOUNDER_PAGE_SOURCE.indexOf('function ProductUsage()')
    const end = FOUNDER_PAGE_SOURCE.indexOf('\nfunction ', start + 10)
    const body = FOUNDER_PAGE_SOURCE.slice(start, end)
    const tilesStart = body.indexOf('] as const).map')
    const tilesBlockStart = body.lastIndexOf('([', tilesStart)
    const tilesBlock = body.slice(tilesBlockStart, tilesStart)
    expect(tilesBlock).toContain('Uploads')
    expect(tilesBlock).toContain('Organiser updates')
    // exactly two tuple entries — no third/fourth metric
    expect((tilesBlock.match(/\[\s*'[^']+',/g) ?? []).length).toBe(2)
  })
})

// ── SEMANTICS ────────────────────────────────────────────────────────────

describe('Zero vs failure semantics; no invented wording (tests 9, 10)', () => {
  it('test 9: a genuine zero-row result resolves to numeric 0 for every metric, not null/undefined', async () => {
    queue(ORG_ROW, [{ count: 0 }], [{ count: 0 }])
    const usage = await getProductUsage()
    expect(usage).toEqual({ windowDays: 30, uploads: 0, organiserUpdates: 0 })
  })

  it('test 10: a query failure propagates (all-or-nothing) rather than silently resolving to 0', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    sqlMock.mockRejectedValueOnce(new Error('connection refused'))
    const res = await GET()
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json).not.toHaveProperty('uploads')
  })

  it('the frontend renders the established "Not connected" state on load failure, never a fabricated 0', () => {
    const start = FOUNDER_PAGE_SOURCE.indexOf('function ProductUsage()')
    const end = FOUNDER_PAGE_SOURCE.indexOf('\nfunction ', start + 10)
    const body = FOUNDER_PAGE_SOURCE.slice(start, end)
    expect(body).toContain('loadError || !data')
    expect(body).toContain('Not connected')
  })

  it('the UI shows "Last {windowDays} days", not a hardcoded "30" separate from the API value', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain('Last {data.windowDays} days')
  })

  it('no percentages, trend arrows, or comparison-period language exist in the new UI code', () => {
    const start = FOUNDER_PAGE_SOURCE.indexOf('function ProductUsage()')
    const end = FOUNDER_PAGE_SOURCE.indexOf('\nfunction ', start + 10)
    const body = FOUNDER_PAGE_SOURCE.slice(start, end)
    expect(body).not.toMatch(/%|trend|vs\.|compared to/i)
  })

  it('no "active users" or "active organisations" wording exists in the new backend files or the ProductUsage() UI specifically', () => {
    for (const src of [SIGNALS_SOURCE, ROUTE_SOURCE]) {
      expect(src).not.toMatch(/active users|active organisations/i)
    }
    const start = FOUNDER_PAGE_SOURCE.indexOf('function ProductUsage()')
    const end = FOUNDER_PAGE_SOURCE.indexOf('\nfunction ', start + 10)
    const body = FOUNDER_PAGE_SOURCE.slice(start, end)
    expect(body).not.toMatch(/active users|active organisations/i)
  })
})

// ── SECURITY ─────────────────────────────────────────────────────────────

describe('Response contains aggregate numbers only (test 8, 14)', () => {
  it('test 8: functional: the full GET response has exactly the three documented fields and nothing else', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    queue(ORG_ROW, [{ count: 1 }], [{ count: 2 }])
    const res = await GET()
    const json = await res.json()
    expect(Object.keys(json).sort()).toEqual(['organiserUpdates', 'uploads', 'windowDays'])
    expect(typeof json.uploads).toBe('number')
    expect(typeof json.organiserUpdates).toBe('number')
    expect(json.windowDays).toBe(30)
  })

  it('test 14: no organisation ids, user ids, tokens, or secrets ever appear in the response', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    queue(ORG_ROW, [{ count: 1 }], [{ count: 1 }])
    const res = await GET()
    const json = await res.json()
    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain(BRAINBASE_ORG_ID)
    expect(serialized).not.toMatch(/token|secret|config|password/i)
  })
})

// ── UI CONTAINMENT (do not repeat the Phase E.1 CSS-grid min-width bug) ───

describe('Product Usage layout is responsive and cannot overflow (test 16)', () => {
  it('the grid container and every grid item carry minWidth: 0', () => {
    const start = FOUNDER_PAGE_SOURCE.indexOf('function ProductUsage()')
    const end = FOUNDER_PAGE_SOURCE.indexOf('\nfunction ', start + 10)
    const body = FOUNDER_PAGE_SOURCE.slice(start, end)
    const minWidthZeroCount = (body.match(/minWidth: 0/g) ?? []).length
    expect(minWidthZeroCount).toBeGreaterThanOrEqual(2) // grid container + at least the mapped item template
  })

  it('tile labels have explicit wrap containment, not whiteSpace: nowrap', () => {
    const start = FOUNDER_PAGE_SOURCE.indexOf('function ProductUsage()')
    const end = FOUNDER_PAGE_SOURCE.indexOf('\nfunction ', start + 10)
    const body = FOUNDER_PAGE_SOURCE.slice(start, end)
    expect(body).toContain("overflowWrap: 'anywhere'")
    expect(body).toContain("wordBreak: 'break-word'")
    expect(body).not.toContain("whiteSpace: 'nowrap'")
  })

  it('no broad page-level overflow:hidden shortcut was introduced', () => {
    expect(FOUNDER_PAGE_SOURCE).not.toMatch(/margin:\s*'-40px'[\s\S]{0,400}overflow:\s*'hidden'[\s\S]{0,200}overflowX/)
  })
})

// ── UI: exactly the two authorised metrics (test 11) ────────────────────

describe('UI renders exactly the two authorised metrics (test 11)', () => {
  it('renders Uploads and Organiser updates tiles bound to the real API fields', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("['Uploads', data.uploads]")
    expect(FOUNDER_PAGE_SOURCE).toContain("['Organiser updates', data.organiserUpdates]")
  })
})

// ── REGRESSION ───────────────────────────────────────────────────────────

describe('Regression: SystemHealth/LiveContext/System API/Command/Organiser untouched', () => {
  it('SystemHealth() still exists and still fetches /api/founder/system, unaffected by this change', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain('function SystemHealth()')
    expect(FOUNDER_PAGE_SOURCE).toContain("fetch('/api/founder/system')")
  })

  it('LiveContext() still exists and still renders its own honest Not-connected states', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain('function LiveContext()')
  })

  it('the System API/signals files are unmodified (established markers still present)', () => {
    expect(SYSTEM_ROUTE_SOURCE).toContain('requireFounderSession')
    expect(SYSTEM_ROUTE_SOURCE).not.toContain('uploaded_files')
    expect(SYSTEM_ROUTE_SOURCE).not.toContain('social_insights')
  })

  it('the Founder attention-queue route is untouched', () => {
    expect(ATTN_QUEUE_ROUTE_SOURCE).toContain("const REQUEST_ACTIONABLE_STATUSES = ['new', 'in_progress'];")
  })

  it('Command and Organiser pages are untouched (established markers still present)', () => {
    expect(COMMAND_PAGE_SOURCE).toContain('Demo Environment')
    expect(ORGANISER_PAGE_SOURCE).toContain('export default function OrganiserPage() {')
  })

  it('app/api/social/analyse/route.ts and app/api/briefings/route.ts are untouched (still use their own established ::uuid cast — this correction did not need to change them)', () => {
    const socialAnalyseSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/social/analyse/route.ts'), 'utf-8')
    const briefingsSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/briefings/route.ts'), 'utf-8')
    expect(socialAnalyseSource).toContain('::uuid')
    expect(briefingsSource).toContain('::uuid')
  })
})
