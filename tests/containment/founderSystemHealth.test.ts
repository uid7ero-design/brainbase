import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Founder OS Phase E.1 — real system-health signals.
//
// Phase E.0's repository audit proposed cards backed by integrations,
// sync_jobs, agent_runs, and users.last_seen_at. A read-only Production
// check James ran directly against Neon proved those don't exist in
// Production (integrations/sync_jobs/agent_runs tables are absent) and
// that users.last_login_at — the column Production DOES have — is
// unpopulated for all 5 users. Phase E.1 was scoped down accordingly:
// application identity (Vercel env vars), one live DB check, and
// BrainBase's own Gmail/Google Calendar/Instagram connection state only.
// This file proves none of the removed sources leaked back in, that
// deployment identity/database/service-connection wording stays literally
// honest, that Instagram resolution can't follow org_override
// impersonation, and that no secrets/tokens are ever returned.
//
// The Attention Queue DB-outage sub-feature (Phase E.0 §9) was NOT
// implemented — app/api/founder/attention-queue/route.ts's own aggregate
// query depends on the same database a DB-outage alert would need to
// report on: a genuine outage makes that endpoint's Promise.all itself
// throw (500, items: []), so it cannot reliably render a synthetic
// "Database unavailable" item during the exact outage that alert exists
// to describe — the circularity Phase E.0/E.1's own instructions warned
// about. The Database card on System is the authoritative, truthful
// status instead; attention-queue/route.ts was left completely untouched
// (see the "no unrelated regression" section below for its own coverage).

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

// sqlMock's own inferred call signature takes zero args (only its wrapper
// above forwards them), so .mock.calls entries type as `[]` — cast through
// `unknown` to inspect the real runtime arguments each call received (same
// fix as founderTasks.test.ts's sqlCallArgs()).
function sqlCallArgs(index: number): unknown[] {
  return sqlMock.mock.calls[index] as unknown as unknown[]
}

const readGmailTokensMock = vi.fn()
vi.mock('@/lib/gmail/tokens', () => ({
  readTokens: (...args: unknown[]) => readGmailTokensMock(...args),
}))

const readGcalTokensMock = vi.fn()
vi.mock('@/lib/gcal/tokens', () => ({
  readAllTokens: (...args: unknown[]) => readGcalTokensMock(...args),
}))

const decryptMock = vi.fn((v: string) => v)
vi.mock('@/lib/social/crypto', () => ({
  decrypt: (v: string) => decryptMock(v),
}))

const fetchMock = vi.fn()

const { GET } = await import('@/app/api/founder/system/route')
const {
  getApplicationIdentity, checkDatabase, getGmailState, getGoogleCalendarState, getInstagramState,
} = await import('@/lib/founder/systemSignals')

const ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/system/route.ts'), 'utf-8')
const SIGNALS_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../lib/founder/systemSignals.ts'), 'utf-8')
const FOUNDER_PAGE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/admin/founder/page.tsx'), 'utf-8')
const ATTN_QUEUE_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/attention-queue/route.ts'), 'utf-8')
const ORGANISER_PAGE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/organiser/page.tsx'), 'utf-8')
const COMMAND_PAGE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/command/page.tsx'), 'utf-8')

// Scoped to executable code, not this file's own explanatory prose — both
// new files' comments legitimately name the removed/absent Production
// sources (integrations, sync_jobs, agent_runs, last_seen_at,
// last_login_at) and requireSession/getAuthSession when explaining why
// they are NOT used, same established pattern as founderTasks.test.ts /
// organiserCanonicalRoute.test.ts.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}
const ROUTE_EXECUTABLE = stripComments(ROUTE_SOURCE)
const SIGNALS_EXECUTABLE = stripComments(SIGNALS_SOURCE)

const SUPER_ADMIN = { role: 'super_admin', organisationId: 'org-caller', userId: 'u1' }
const ORG_ROW = [{ id: 'org-brainbase' }]

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

const ORIGINAL_ENV = { ...process.env }
const originalFetch = global.fetch

beforeEach(() => {
  getAuthSessionMock.mockReset()
  sqlMock.mockClear()
  readGmailTokensMock.mockReset()
  readGcalTokensMock.mockReset()
  decryptMock.mockClear()
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  responseQueue = []
  callCount = 0
  process.env = { ...ORIGINAL_ENV }
  delete process.env.VERCEL_ENV
  delete process.env.VERCEL_GIT_COMMIT_SHA
  delete process.env.VERCEL_GIT_COMMIT_MESSAGE
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  global.fetch = originalFetch
})

// ── 1. Access gating ─────────────────────────────────────────────────────

describe('GET /api/founder/system — access gating', () => {
  it('401 with no session, 403 for a non-super_admin session, no sql/token/fetch calls in either case', async () => {
    getAuthSessionMock.mockRejectedValue(new Error('Unauthorized'))
    expect((await GET()).status).toBe(401)
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-1', userId: 'u1' })
    expect((await GET()).status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
    expect(readGmailTokensMock).not.toHaveBeenCalled()
    expect(readGcalTokensMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('200 for a super_admin session', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    readGmailTokensMock.mockReturnValue(null)
    readGcalTokensMock.mockReturnValue([])
    // Call order: checkDatabase's SELECT 1, resolveBrainbaseOrgId's org
    // lookup, getMicrosoftState's connection-summary read (Phase E.5A),
    // then getInstagramState's social_connections lookup (resumes last,
    // after its own org-lookup await settles).
    queue([{ '?column?': 1 }], ORG_ROW, [], [])
    const res = await GET()
    expect(res.status).toBe(200)
  })
})

// ── 2. Removed/nonexistent Production sources are never used ───────────────

describe('Does not depend on sources proven absent/unpopulated in Production', () => {
  it('neither the route nor lib/founder/systemSignals.ts references integrations, sync_jobs, or agent_runs in executable code', () => {
    for (const src of [ROUTE_EXECUTABLE, SIGNALS_EXECUTABLE]) {
      expect(src).not.toContain('integrations')
      expect(src).not.toContain('sync_jobs')
      expect(src).not.toContain('agent_runs')
    }
  })

  it('neither file references users.last_seen_at or users.last_login_at in executable code', () => {
    for (const src of [ROUTE_EXECUTABLE, SIGNALS_EXECUTABLE]) {
      expect(src).not.toContain('last_seen_at')
      expect(src).not.toContain('last_login_at')
    }
  })

  it('functional: every real sql`` call made during a full successful GET is SELECT 1, the BrainBase org lookup, the microsoft_connections read, or the social_connections lookup — nothing else', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    readGmailTokensMock.mockReturnValue(null)
    readGcalTokensMock.mockReturnValue([])
    queue([{ '?column?': 1 }], ORG_ROW, [], [])
    await GET()
    expect(sqlMock).toHaveBeenCalledTimes(4)
    const allCallStrings = sqlMock.mock.calls
      .map((_, i) => (sqlCallArgs(i)[0] as TemplateStringsArray).join(''))
      .join('\n')
    expect(allCallStrings).not.toMatch(/integrations|sync_jobs|agent_runs|last_seen_at|last_login_at/)
  })
})

// ── 3/4. Application/deployment identity ────────────────────────────────────

describe('Application identity comes only from the three allowed Vercel env values', () => {
  it('the signals module reads only VERCEL_ENV / VERCEL_GIT_COMMIT_SHA / VERCEL_GIT_COMMIT_MESSAGE', () => {
    expect(SIGNALS_SOURCE).toContain('process.env.VERCEL_ENV')
    expect(SIGNALS_SOURCE).toContain('process.env.VERCEL_GIT_COMMIT_SHA')
    expect(SIGNALS_SOURCE).toContain('process.env.VERCEL_GIT_COMMIT_MESSAGE')
    expect(SIGNALS_SOURCE).not.toContain('VERCEL_URL')
    expect(SIGNALS_SOURCE).not.toContain('VERCEL_DEPLOYMENT_ID')
  })

  it('returns the real values when the env vars are present', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567890'
    process.env.VERCEL_GIT_COMMIT_MESSAGE = 'fix(organiser): promote Organiser out of Command'
    const identity = getApplicationIdentity()
    expect(identity).toEqual({
      environment: 'production',
      commitSha: 'abcdef1234567890',
      commitShaShort: 'abcdef1',
      commitMessage: 'fix(organiser): promote Organiser out of Command',
    })
  })

  it('missing env values render as Unknown/null, never fabricated', () => {
    const identity = getApplicationIdentity()
    expect(identity).toEqual({
      environment: 'Unknown',
      commitSha: null,
      commitShaShort: null,
      commitMessage: null,
    })
  })
})

// ── 5/6. Database check ──────────────────────────────────────────────────

describe('Database status is a real, timed check — never converted to Healthy on failure', () => {
  it('checkDatabase() runs a real query and reports ok:true with a numeric latency on success', async () => {
    sqlMock.mockResolvedValueOnce([{ '?column?': 1 }])
    const status = await checkDatabase()
    expect(status.ok).toBe(true)
    expect(typeof status.latencyMs).toBe('number')
    expect(status.latencyMs).toBeGreaterThanOrEqual(0)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('checkDatabase() reports ok:false with latencyMs null on failure — never ok:true', async () => {
    sqlMock.mockRejectedValueOnce(new Error('connection refused'))
    const status = await checkDatabase()
    expect(status.ok).toBe(false)
    expect(status.latencyMs).toBeNull()
  })

  it('the route never reports a database failure as application-level "healthy" text — it passes the raw ok boolean straight through', () => {
    expect(ROUTE_SOURCE).not.toContain("'Healthy'")
    expect(ROUTE_SOURCE).not.toContain('"Healthy"')
  })

  it('the underlying SQL is a trivial SELECT 1, not something that could itself fail for unrelated reasons', () => {
    expect(SIGNALS_SOURCE).toContain('await sql`SELECT 1`')
  })

  it('latencyMs is never described as an average, SLA, or uptime figure in any executable/UI-facing text', () => {
    expect(SIGNALS_EXECUTABLE).not.toMatch(/uptime|SLA|average latency/i)
    expect(ROUTE_EXECUTABLE).not.toMatch(/uptime|SLA|average latency/i)
    // FOUNDER_PAGE_SOURCE is checked whole (not comment-stripped) because
    // this one specifically must hold for user-visible JSX text too, not
    // just executable logic — and this file's own SystemHealth() JSX
    // never mentions any of these terms in its rendered strings.
    expect(FOUNDER_PAGE_SOURCE).not.toMatch(/>.*?(uptime|SLA|average latency).*?</i)
  })
})

// ── 7. Gmail/GCal — presence semantics only ─────────────────────────────────

describe('Gmail/Google Calendar report connection presence only, never a live-health claim', () => {
  it('getGmailState/getGoogleCalendarState never call fetch — no live API check is made', () => {
    const gmailFnStart = SIGNALS_SOURCE.indexOf('export function getGmailState')
    const gmailFnEnd = SIGNALS_SOURCE.indexOf('\n}', gmailFnStart)
    const gcalFnStart = SIGNALS_SOURCE.indexOf('export function getGoogleCalendarState')
    const gcalFnEnd = SIGNALS_SOURCE.indexOf('\n}', gcalFnStart)
    expect(SIGNALS_SOURCE.slice(gmailFnStart, gmailFnEnd)).not.toContain('fetch(')
    expect(SIGNALS_SOURCE.slice(gcalFnStart, gcalFnEnd)).not.toContain('fetch(')
  })

  it('getGmailState() returns connected/not_connected purely from readTokens() presence', () => {
    readGmailTokensMock.mockReturnValue({ access_token: 'x', refresh_token: 'y', expires_at: 1 })
    expect(getGmailState()).toBe('connected')
    readGmailTokensMock.mockReturnValue(null)
    expect(getGmailState()).toBe('not_connected')
  })

  it('getGoogleCalendarState() returns connected/not_connected purely from readAllTokens() length', () => {
    readGcalTokensMock.mockReturnValue([{ access_token: 'x', refresh_token: 'y', expires_at: 1, email: 'a@b.com' }])
    expect(getGoogleCalendarState()).toBe('connected')
    readGcalTokensMock.mockReturnValue([])
    expect(getGoogleCalendarState()).toBe('not_connected')
  })

  it('a read failure surfaces as unknown, never as connected', () => {
    readGmailTokensMock.mockImplementation(() => { throw new Error('fs error') })
    expect(getGmailState()).toBe('unknown')
  })

  it('the UI never labels Gmail/GCal "Healthy" — only Connected/Not connected/Connection issue/Unknown, with explicit presence-only wording', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("connected: 'Connected', not_connected: 'Not connected',")
    expect(FOUNDER_PAGE_SOURCE).toContain('not a live API check')
  })
})

// ── 8. Instagram — BrainBase-org resolution cannot follow impersonation ────

describe('Instagram state resolves BrainBase\'s own organisation, immune to org_override impersonation', () => {
  it('systemSignals.ts never imports getAuthSession/requireSession — Instagram resolution cannot be influenced by the caller\'s session at all', () => {
    expect(SIGNALS_EXECUTABLE).not.toContain('getAuthSession')
    expect(SIGNALS_EXECUTABLE).not.toContain('requireSession')
    expect(SIGNALS_EXECUTABLE).not.toContain("from '@/lib/org'")
  })

  it('it reuses resolveBrainbaseOrgId() from lib/founder/tasksBoard.ts (the same impersonation-proof resolver Founder Tasks already established) rather than a new/independent lookup', () => {
    expect(SIGNALS_SOURCE).toContain("import { resolveBrainbaseOrgId } from '@/lib/founder/tasksBoard';")
  })

  it('functional: resolves not_connected when BrainBase has no social_connections row, regardless of what org a caller session claims', async () => {
    queue(ORG_ROW, [])
    const state = await getInstagramState()
    expect(state).toBe('not_connected')
  })

  it('functional: resolves connected when a row exists with no instagram_account_id yet (no live check attempted)', async () => {
    queue(ORG_ROW, [{ access_token: 'enc', instagram_account_id: null }])
    const state = await getInstagramState()
    expect(state).toBe('connected')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('functional: resolves connected_issue when the live Graph API call itself errors', async () => {
    queue(ORG_ROW, [{ access_token: 'enc', instagram_account_id: 'ig-123' }])
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({ error: { message: 'Invalid OAuth access token' } }) })
    const state = await getInstagramState()
    expect(state).toBe('connected_issue')
  })

  it('functional: resolves connected when the live Graph API call succeeds', async () => {
    queue(ORG_ROW, [{ access_token: 'enc', instagram_account_id: 'ig-123' }])
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({ data: [{ id: '1' }] }) })
    const state = await getInstagramState()
    expect(state).toBe('connected')
  })

  it('functional: resolves unknown if BrainBase\'s own organisation cannot be resolved at all', async () => {
    queue([])
    const state = await getInstagramState()
    expect(state).toBe('unknown')
  })
})

// ── 9. No secrets/tokens/config ever returned ───────────────────────────────

describe('No tokens, secrets, or integration config are ever returned', () => {
  it('functional: the full GET response contains no access_token/refresh_token/config keys anywhere', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    readGmailTokensMock.mockReturnValue({ access_token: 'super-secret-gmail', refresh_token: 'r', expires_at: 1 })
    readGcalTokensMock.mockReturnValue([{ access_token: 'super-secret-gcal', refresh_token: 'r', expires_at: 1, email: 'a@b.com' }])
    queue([{ '?column?': 1 }], ORG_ROW, [], [{ access_token: 'super-secret-instagram', instagram_account_id: null }])
    const res = await GET()
    const json = await res.json()
    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain('super-secret')
    expect(serialized).not.toContain('access_token')
    expect(serialized).not.toContain('refresh_token')
    expect(serialized).not.toContain('config')
  })

  it('a Graph API error message is never forwarded to the client — only a state enum', async () => {
    getAuthSessionMock.mockResolvedValue(SUPER_ADMIN)
    readGmailTokensMock.mockReturnValue(null)
    readGcalTokensMock.mockReturnValue([])
    queue([{ '?column?': 1 }], ORG_ROW, [], [{ access_token: 'enc', instagram_account_id: 'ig-123' }])
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({ error: { message: 'SENSITIVE_GRAPH_DETAIL' } }) })
    const res = await GET()
    const json = await res.json()
    expect(JSON.stringify(json)).not.toContain('SENSITIVE_GRAPH_DETAIL')
    expect(json.services.instagram.state).toBe('connected_issue')
  })
})

// ── 10. LiveContext remains an honest placeholder; ProductUsage was
// intentionally superseded by Phase E.3 (real 30-day product-usage
// aggregates — see tests/containment/founderProductUsage.test.ts) ─────────

describe('LiveContext is untouched — still an honest "Not connected" state; ProductUsage is now real (Phase E.3)', () => {
  it('ProductUsage() now fetches real data from GET /api/founder/usage and falls back to Not connected only on load failure — no longer a static placeholder', () => {
    const start = FOUNDER_PAGE_SOURCE.indexOf('function ProductUsage()')
    const end = FOUNDER_PAGE_SOURCE.indexOf('\nfunction ', start + 10)
    const body = FOUNDER_PAGE_SOURCE.slice(start, end)
    expect(body).toContain("fetch('/api/founder/usage')")
    expect(body).toContain('Not connected') // still the honest load-failure state
  })

  it('LiveContext() still renders Not connected with no fetch/data source', () => {
    const start = FOUNDER_PAGE_SOURCE.indexOf('function LiveContext()')
    const end = FOUNDER_PAGE_SOURCE.indexOf('// ─── Client drawer', start)
    const body = FOUNDER_PAGE_SOURCE.slice(start, end)
    expect(body).toContain('Not connected')
    expect(body).not.toContain('fetch(')
  })
})

// ── 11/12/13. No unrelated regression, no schema change, no fake data ──────

describe('Containment: no Command/Organiser change, no schema change, no fabricated values', () => {
  it('app/organiser/page.tsx and app/command/page.tsx are unmodified by this phase (established markers still present)', () => {
    expect(ORGANISER_PAGE_SOURCE).toContain('export default function OrganiserPage() {')
    expect(COMMAND_PAGE_SOURCE).toContain('Demo Environment')
  })

  it('neither new file contains any DDL (CREATE TABLE / ALTER TABLE) — no schema/migration change', () => {
    for (const src of [ROUTE_SOURCE, SIGNALS_SOURCE]) {
      expect(src).not.toMatch(/CREATE TABLE|ALTER TABLE/i)
    }
  })

  it('no MOCK_/DEMO_/FAKE_ constant exists in the new system-health files', () => {
    for (const src of [ROUTE_SOURCE, SIGNALS_SOURCE]) {
      expect(src).not.toMatch(/const MOCK_|const DEMO_|const FAKE_/)
    }
  })

  it('the Founder attention-queue route is completely untouched — the DB-outage alert sub-feature was deliberately not implemented (circularity — see this file\'s header)', () => {
    expect(ATTN_QUEUE_ROUTE_SOURCE).toContain("const REQUEST_ACTIONABLE_STATUSES = ['new', 'in_progress'];")
    expect(ATTN_QUEUE_ROUTE_SOURCE).not.toContain('system:db')
    expect(ATTN_QUEUE_ROUTE_SOURCE).not.toContain('Database unavailable')
  })
})

// ── Pre-merge preview correction: Database tile visibility + Application
// commit-message overflow ───────────────────────────────────────────────
//
// Root cause of BOTH confirmed preview defects was the same one bug, not
// two: the Application/Database tiles sit in a `display: grid;
// gridTemplateColumns: '1fr 1fr'` row with no minWidth: 0 on either grid
// item. CSS grid items default to min-width: auto, so a long, unbroken
// commit message (whiteSpace: nowrap, no wrap opportunities) forced the
// Application column to grow to its full intrinsic text width — which
// both overflowed the card/page (defect 2) AND pushed/squeezed the
// Database column out of the visible row in the same breath (defect 1).
// GET /api/founder/system always includes `database` in its response
// (see the "Does not depend on..." and "Database status..." suites above,
// both still passing unmodified) — the tile was never missing from data,
// only from the rendered layout. Fixed with minWidth: 0 on both grid
// items plus wrapping/line-clamping the commit message instead of forcing
// it onto one unbroken line — no API/data change was needed or made.

describe('Pre-merge correction: Database tile visible, Application overflow contained', () => {
  it('both grid items carry minWidth: 0 — the actual fix for both confirmed preview defects', () => {
    const gridStart = FOUNDER_PAGE_SOURCE.indexOf("gridTemplateColumns: '1fr 1fr'")
    const gridEnd = FOUNDER_PAGE_SOURCE.indexOf('Service connections', gridStart)
    const gridBlock = FOUNDER_PAGE_SOURCE.slice(gridStart - 40, gridEnd)
    const minWidthZeroCount = (gridBlock.match(/minWidth: 0/g) ?? []).length
    // grid container + Application item + Database item = 3 occurrences
    expect(minWidthZeroCount).toBeGreaterThanOrEqual(3)
  })

  it('the Database tile is present in the same grid row as Application, unconditionally rendered whenever data has loaded', () => {
    const start = FOUNDER_PAGE_SOURCE.indexOf("gridTemplateColumns: '1fr 1fr'")
    const end = FOUNDER_PAGE_SOURCE.indexOf('Service connections', start)
    const block = FOUNDER_PAGE_SOURCE.slice(start, end)
    expect(block).toContain('>Application<')
    expect(block).toContain('>Database<')
    expect(block).not.toMatch(/Database[\s\S]{0,60}(display:\s*['"]none['"]|hidden\s*:\s*true)/)
  })

  it('Operational state renders the real request latency, sourced from database.latencyMs, not a hardcoded/average figure', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain('{database.ok && database.latencyMs != null ? `${database.latencyMs} ms this request · live check` : \'Live check\'}')
  })

  it('a database failure renders the literal label "Unavailable", driven by database.ok being false — never "Healthy"/"Operational"', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("const dbLabel = database.ok ? 'Operational' : 'Unavailable';")
  })

  it('no uptime/average/SLA language was introduced by this correction (re-asserts the Phase E.1 rule still holds after the layout change)', () => {
    expect(FOUNDER_PAGE_SOURCE).not.toMatch(/>.*?(uptime|SLA|average latency).*?</i)
  })

  it('the Application tile still displays the real commit message text — the correction changes CSS containment only, never the data', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain('{application.commitMessage && (')
    expect(FOUNDER_PAGE_SOURCE).toContain('{application.commitMessage}</div>')
  })

  it('the commit message has explicit wrap/break containment (not whiteSpace: nowrap) and a line clamp, suitable for an arbitrarily long string with no spaces', () => {
    const msgStart = FOUNDER_PAGE_SOURCE.indexOf('{application.commitMessage && (')
    const msgEnd = FOUNDER_PAGE_SOURCE.indexOf(')}', msgStart)
    const block = FOUNDER_PAGE_SOURCE.slice(msgStart, msgEnd)
    expect(block).toContain("overflowWrap: 'anywhere'")
    expect(block).toContain("wordBreak: 'break-word'")
    expect(block).toContain('WebkitLineClamp: 2')
    expect(block).not.toContain("whiteSpace: 'nowrap'")
  })

  it('the fix is scoped to the Application/Database tiles only — no broad overflow:hidden was applied to the whole Founder OS page', () => {
    // The two intentional, tile-scoped overflow:hidden additions (grid item
    // containers) are expected; this guards against a much broader
    // page/body-level overflow:hidden being introduced as a shortcut.
    expect(FOUNDER_PAGE_SOURCE).not.toMatch(/margin:\s*'-40px'[\s\S]{0,400}overflow:\s*'hidden'[\s\S]{0,200}overflowX/)
  })
})
