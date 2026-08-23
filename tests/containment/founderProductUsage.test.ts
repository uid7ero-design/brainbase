import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Founder OS Phase E.3 — real Product Usage signals.
//
// Scoped EXACTLY to the four sources a Phase E.2 audit confirmed
// authoritative: uploaded_files, organiser_item_updates, social_insights,
// saved_briefings. integrations/sync_jobs/agent_runs do not exist in
// Production; users.last_seen_at does not exist; users.last_login_at is
// unpopulated for all 5 Production users — none of those are queried
// anywhere in this change. organiser_items (as opposed to
// organiser_item_updates) is deliberately never queried: bulk CSV import
// can create many organiser_items from one user action with no
// distinguishing marker. Active organisations/users, general AI usage,
// task completions, bookings, dashboard activity, trends, and
// percentages were all explicitly excluded from V1 per that audit.
//
// social_insights.organisation_id and saved_briefings.organisation_id
// are genuinely typed UUID (unlike every other table here, which is
// TEXT) — the ::uuid cast used in lib/founder/usageSignals.ts is the
// same, already-live pattern app/api/briefings/route.ts and
// app/api/social/analyse/route.ts themselves use to WRITE to these two
// tables in Production today, not a guess.

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
// agent_runs/last_seen_at/last_login_at/organiser_items while explaining
// why they are NOT used) — same established pattern as
// founderSystemHealth.test.ts / founderTasks.test.ts.
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

  it('200 for a super_admin session, only after auth succeeds', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    queue(ORG_ROW, [{ count: 0 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }])
    const res = await GET()
    expect(res.status).toBe(200)
  })
})

// ── SOURCE TRUTH ─────────────────────────────────────────────────────────

describe('Only the four E.2-approved sources are used', () => {
  it('references uploaded_files, organiser_item_updates, social_insights, and saved_briefings', () => {
    expect(SIGNALS_SOURCE).toContain('FROM uploaded_files')
    expect(SIGNALS_SOURCE).toContain('FROM organiser_item_updates')
    expect(SIGNALS_SOURCE).toContain('FROM social_insights')
    expect(SIGNALS_SOURCE).toContain('FROM saved_briefings')
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

  it('never queries organiser_items (as opposed to organiser_item_updates) in executable code', () => {
    expect(SIGNALS_EXECUTABLE).not.toMatch(/FROM organiser_items\b/)
  })

  it('functional: every real sql`` call made during a full successful GET touches only the four approved tables', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    queue(ORG_ROW, [{ count: 1 }], [{ count: 2 }], [{ count: 3 }], [{ count: 4 }])
    await GET()
    expect(sqlMock).toHaveBeenCalledTimes(5)
    const allCallStrings = sqlMock.mock.calls
      .map((_, i) => (sqlCallArgs(i)[0] as TemplateStringsArray).join(''))
      .join('\n')
    expect(allCallStrings).not.toMatch(/\bintegrations\b|\bsync_jobs\b|\bagent_runs\b|last_seen_at|last_login_at/)
    expect(allCallStrings).not.toMatch(/FROM organiser_items\b/)
  })
})

// ── UPLOADS ──────────────────────────────────────────────────────────────

describe('Uploads', () => {
  it('30-day window, demo-seed.csv exclusion, and BrainBase-org exclusion are present in source', () => {
    const start = SIGNALS_SOURCE.indexOf('FROM uploaded_files')
    const end = SIGNALS_SOURCE.indexOf('`,', start)
    const block = SIGNALS_SOURCE.slice(start, end)
    expect(block).toContain("INTERVAL '30 days'")
    expect(block).toContain("file_name <> 'demo-seed.csv'")
    expect(block).toContain('organisation_id <> ${brainbaseOrgId}')
  })

  it('functional: resolves the count returned by the query', async () => {
    queue(ORG_ROW, [{ count: 7 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }])
    const usage = await getProductUsage()
    expect(usage.uploads).toBe(7)
  })

  it('the API response never includes a filename or any per-row field', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    queue(ORG_ROW, [{ count: 1 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }])
    const res = await GET()
    const json = await res.json()
    expect(JSON.stringify(json)).not.toMatch(/file_name|\.csv|uploaded_by/)
  })
})

// ── ORGANISER ────────────────────────────────────────────────────────────

describe('Organiser updates', () => {
  it('organiser_item_updates is used, organiser_items is not, BrainBase org is excluded', () => {
    const start = SIGNALS_SOURCE.indexOf('FROM organiser_item_updates')
    const end = SIGNALS_SOURCE.indexOf('`,', start)
    const block = SIGNALS_SOURCE.slice(start, end)
    expect(block).toContain("INTERVAL '30 days'")
    expect(block).toContain('organisation_id <> ${brainbaseOrgId}')
    expect(block).not.toContain('organiser_items ')
  })

  it('functional: resolves the count returned by the query', async () => {
    queue(ORG_ROW, [{ count: 0 }], [{ count: 5 }], [{ count: 0 }], [{ count: 0 }])
    const usage = await getProductUsage()
    expect(usage.organiserUpdates).toBe(5)
  })

  it('the API response never includes author_name or comment body content', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    queue(ORG_ROW, [{ count: 0 }], [{ count: 1 }], [{ count: 0 }], [{ count: 0 }])
    const res = await GET()
    const json = await res.json()
    expect(JSON.stringify(json)).not.toMatch(/author_name|body/)
  })
})

// ── SOCIAL ───────────────────────────────────────────────────────────────

describe('Social analyses', () => {
  it('social_insights is used with an explicit ::uuid cast for the organisation_id comparison, BrainBase org excluded', () => {
    const start = SIGNALS_SOURCE.indexOf('FROM social_insights')
    const end = SIGNALS_SOURCE.indexOf('`,', start)
    const block = SIGNALS_SOURCE.slice(start, end)
    expect(block).toContain("INTERVAL '30 days'")
    expect(block).toContain('organisation_id <> ${brainbaseOrgId}::uuid')
  })

  it('functional: resolves the count returned by the query', async () => {
    queue(ORG_ROW, [{ count: 0 }], [{ count: 0 }], [{ count: 3 }], [{ count: 0 }])
    const usage = await getProductUsage()
    expect(usage.socialAnalyses).toBe(3)
  })

  it('the UI labels this specifically "Social analyses", never "AI usage"/"HLNA usage"/"AI requests"', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("['Social analyses', data.socialAnalyses]")
    const start = FOUNDER_PAGE_SOURCE.indexOf('function ProductUsage()')
    const end = FOUNDER_PAGE_SOURCE.indexOf('\nfunction ', start + 10)
    const body = FOUNDER_PAGE_SOURCE.slice(start, end)
    expect(body).not.toMatch(/AI usage|HLNA usage|AI requests/)
  })
})

// ── BRIEFINGS ────────────────────────────────────────────────────────────

describe('Briefings generated', () => {
  it('saved_briefings is used with an explicit ::uuid cast for the organisation_id comparison, BrainBase org excluded', () => {
    const start = SIGNALS_SOURCE.indexOf('FROM saved_briefings')
    const end = SIGNALS_SOURCE.indexOf('`,', start)
    const block = SIGNALS_SOURCE.slice(start, end)
    expect(block).toContain("INTERVAL '30 days'")
    expect(block).toContain('organisation_id <> ${brainbaseOrgId}::uuid')
  })

  it('functional: resolves the count returned by the query', async () => {
    queue(ORG_ROW, [{ count: 0 }], [{ count: 0 }], [{ count: 0 }], [{ count: 9 }])
    const usage = await getProductUsage()
    expect(usage.briefingsGenerated).toBe(9)
  })

  it('the UI labels this specifically "Briefings generated", never "viewed"/"acted on"/"AI requests"', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("['Briefings generated', data.briefingsGenerated]")
    expect(FOUNDER_PAGE_SOURCE).not.toMatch(/Briefings viewed|Briefings acted on/)
  })
})

// ── SEMANTICS ────────────────────────────────────────────────────────────

describe('Zero vs failure semantics; no invented wording', () => {
  it('a genuine zero-row result resolves to numeric 0 for every metric, not null/undefined', async () => {
    queue(ORG_ROW, [{ count: 0 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }])
    const usage = await getProductUsage()
    expect(usage).toEqual({ windowDays: 30, uploads: 0, organiserUpdates: 0, socialAnalyses: 0, briefingsGenerated: 0 })
  })

  it('a query failure propagates (all-or-nothing) rather than silently resolving to 0', async () => {
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

  it('no "active users" or "active organisations" wording exists anywhere in the new files', () => {
    for (const src of [SIGNALS_SOURCE, ROUTE_SOURCE, FOUNDER_PAGE_SOURCE]) {
      expect(src).not.toMatch(/active users|active organisations/i)
    }
  })
})

// ── SECURITY ─────────────────────────────────────────────────────────────

describe('Response contains aggregate numbers only', () => {
  it('functional: the full GET response has exactly the five documented fields and nothing else', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    queue(ORG_ROW, [{ count: 1 }], [{ count: 2 }], [{ count: 3 }], [{ count: 4 }])
    const res = await GET()
    const json = await res.json()
    expect(Object.keys(json).sort()).toEqual(['briefingsGenerated', 'organiserUpdates', 'socialAnalyses', 'uploads', 'windowDays'])
    expect(typeof json.uploads).toBe('number')
  })

  it('no organisation ids, user ids, tokens, or secrets ever appear in the response', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    queue(ORG_ROW, [{ count: 1 }], [{ count: 1 }], [{ count: 1 }], [{ count: 1 }])
    const res = await GET()
    const json = await res.json()
    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain(BRAINBASE_ORG_ID)
    expect(serialized).not.toMatch(/token|secret|config|password/i)
  })
})

// ── UI CONTAINMENT (do not repeat the Phase E.1 CSS-grid min-width bug) ───

describe('Product Usage layout is responsive and cannot overflow', () => {
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
})
