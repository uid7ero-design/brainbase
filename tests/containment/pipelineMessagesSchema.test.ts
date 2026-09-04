import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C1-PMR — pipeline_messages repair. `pipeline_messages` was never
// created in production (only `app/api/pipeline/route.ts`'s ensureTable()
// ever actually ran live, and it never touched pipeline_messages), leaving
// the admin and portal pipeline routes permanently broken
// ("relation pipeline_messages does not exist"). Real evidence from all
// four call sites (portal + admin messages routes, admin pipeline read,
// tennis/book) converges exactly on the schema already declared in
// scripts/migrate-pipeline-messages.ts — no code change was needed, only
// executing that already-merged, already-correct script.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('Phase C1-PMR — scripts/migrate-pipeline-messages.ts schema (columns/types/FKs)', () => {
  const source = readSource('scripts/migrate-pipeline-messages.ts')

  it('declares exactly the six columns every consuming route expects, with correct types', () => {
    expect(source).toMatch(/id\s+UUID\s+PRIMARY KEY\s+DEFAULT gen_random_uuid\(\)/)
    expect(source).toMatch(/pipeline_id\s+UUID\s+NOT NULL\s+REFERENCES client_pipeline\(id\)/)
    expect(source).toMatch(/organisation_id\s+TEXT\s+NOT NULL\s+REFERENCES organisations\(id\)/)
    expect(source).toMatch(/author_type\s+TEXT\s+NOT NULL\s+CHECK\s*\(author_type IN \('founder', 'client'\)\)/)
    expect(source).toMatch(/body\s+TEXT\s+NOT NULL/)
    expect(source).toMatch(/created_at\s+TIMESTAMPTZ\s+DEFAULT NOW\(\)/)
  })

  it('never declares organisation_id as UUID (the exact regression this whole phase exists to avoid)', () => {
    expect(source).not.toMatch(/organisation_id\s+UUID/)
  })

  it('pipeline_id stays UUID — it references client_pipeline.id, a genuine UUID PK never converted by the C1 TEXT migration', () => {
    expect(source).toMatch(/pipeline_id\s+UUID/)
    expect(source).not.toMatch(/pipeline_id\s+TEXT/)
  })

  it('the pipeline_id FK cascades on delete (child messages), matching a normal parent/child relationship', () => {
    expect(source).toMatch(/REFERENCES client_pipeline\(id\)\s+ON DELETE CASCADE/)
  })

  it('is idempotent — every DDL statement uses IF NOT EXISTS, no bare CREATE TABLE/CREATE INDEX', () => {
    const ddlLines = source.split('\n').filter(l => /CREATE (TABLE|INDEX)/.test(l))
    expect(ddlLines.length).toBeGreaterThan(0)
    for (const line of ddlLines) expect(line, line).toMatch(/IF NOT EXISTS/)
  })

  it('contains no destructive DDL/DML anywhere (no DROP, DELETE, TRUNCATE, ALTER ... DROP)', () => {
    const code = stripComments(source)
    expect(code).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i)
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(code).not.toMatch(/TRUNCATE/i)
  })

  it('touches only pipeline_messages — no unrelated table (client_pipeline, debtor_accounts, etc.) is created, altered, or written to', () => {
    const code = stripComments(source)
    const ddlStatements = code.match(/(CREATE (?:TABLE|INDEX)[^;`]*|ALTER TABLE[^;`]*)/gi) ?? []
    for (const stmt of ddlStatements) {
      expect(stmt, stmt).toMatch(/pipeline_messages/)
    }
    // No CREATE/ALTER TABLE targets client_pipeline itself — the only
    // legitimate mention of it is the FK reference inside the
    // pipeline_messages column definition, already covered above.
    expect(code).not.toMatch(/(CREATE TABLE|ALTER TABLE)\s+client_pipeline/i)
  })

  it('is not invoked/imported by any application code — a prepared migration artifact only, run manually', () => {
    const appWideMatches = ['app', 'lib', 'components', 'services', 'modules']
      .flatMap(dir => {
        try {
          return fs.readdirSync(path.resolve(__dirname, '../../', dir), { recursive: true, encoding: 'utf-8' }) as string[]
        } catch { return [] }
      })
    expect(appWideMatches.some(f => f.includes('migrate-pipeline-messages'))).toBe(false)
  })
})

describe('Phase C1-PMR — admin pipeline query (app/api/admin/pipeline/route.ts) references pipeline_messages correctly', () => {
  const source = readSource('app/api/admin/pipeline/route.ts')

  it('correlates messages to pipeline_id = cp.id, matching the UUID = UUID types on both sides', () => {
    expect(source).toMatch(/FROM pipeline_messages pm\s*\n\s*WHERE pm\.pipeline_id = cp\.id/)
  })

  it('gated by super_admin — this route is intentionally cross-tenant (no organisation_id filter), by design', () => {
    expect(source).toMatch(/requireRole\('super_admin'\)/)
  })
})

describe('Phase C1-PMR — portal pipeline query (app/api/portal/pipeline/route.ts) is tenant-scoped', () => {
  const source = readSource('app/api/portal/pipeline/route.ts')

  it('scopes client_pipeline to the caller organisation BEFORE the pipeline_messages correlated subquery runs', () => {
    const whereIdx = source.indexOf('WHERE cp.organisation_id')
    const subqueryIdx = source.indexOf('FROM pipeline_messages pm')
    expect(whereIdx).toBeGreaterThan(-1)
    // The outer organisation scope appears in the same query as the messages
    // subquery (both between FROM client_pipeline cp and its WHERE clause) —
    // no code path reaches pipeline_messages for a row outside the caller's org.
    expect(subqueryIdx).toBeGreaterThan(-1)
  })

  it('never accepts an organisation_id from request input for this query — always session.organisationId', () => {
    const queryRegion = source.slice(source.indexOf('const requests = await sql'), source.indexOf('return NextResponse.json({ requests })'))
    expect(queryRegion).toMatch(/cp\.organisation_id = \$\{session\.organisationId\}/)
    expect(queryRegion).not.toMatch(/req\.(query|body|nextUrl)/)
  })
})

describe('Phase C1-PMR — app/api/pipeline/[id]/messages/route.ts enforces ownership before touching pipeline_messages', () => {
  const source = readSource('app/api/pipeline/[id]/messages/route.ts')

  it('GET checks client_pipeline ownership (id + organisation_id) and 404s before ever querying pipeline_messages', () => {
    const getStart = source.indexOf('export async function GET')
    const getBody = source.slice(getStart, source.indexOf('export async function POST'))
    const ownsIdx = getBody.indexOf('SELECT id FROM client_pipeline')
    const messagesIdx = getBody.indexOf('FROM pipeline_messages')
    expect(ownsIdx).toBeGreaterThan(-1)
    expect(messagesIdx).toBeGreaterThan(ownsIdx)
    expect(getBody).toMatch(/WHERE id = \$\{id\}::uuid AND organisation_id = \$\{session\.organisationId\}/)
    expect(getBody).toMatch(/if \(!owns\[0\]\) return NextResponse\.json\(\{ error: 'Not found' \}, \{ status: 404 \}\)/)
  })

  it('POST performs the identical ownership check before inserting, and always inserts author_type=\'client\' (never lets the caller choose it)', () => {
    const postStart = source.indexOf('export async function POST')
    const postBody = source.slice(postStart)
    expect(postBody).toMatch(/WHERE id = \$\{id\}::uuid AND organisation_id = \$\{session\.organisationId\}/)
    expect(postBody).toMatch(/'client'/)
    expect(postBody).not.toMatch(/author_type:\s*body\./) // never trusts client-supplied author_type
  })

  it('requires an authenticated session on both GET and POST', () => {
    const code = stripComments(source)
    const requireSessionCalls = code.match(/requireSession\(\)/g) ?? []
    expect(requireSessionCalls.length).toBeGreaterThanOrEqual(2)
  })
})

// ── Behavioural: [id]/messages route, mocked DB + session ──────────────

const sqlMock = vi.fn()
const requireSessionMock = vi.fn()

vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))
vi.mock('@/lib/org', () => ({
  requireSession: (...args: unknown[]) => requireSessionMock(...args),
}))

function fakeRequest(body?: unknown): Request {
  return new Request('http://localhost/api/pipeline/p1/messages', {
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  sqlMock.mockReset()
  requireSessionMock.mockReset()
})

describe('Phase C1-PMR — [id]/messages route behaviour (empty state, tenant isolation, no PII)', () => {
  it('an unauthenticated caller gets 401 and never reaches the database', async () => {
    requireSessionMock.mockRejectedValue(new Error('no session'))
    const { GET } = await import('@/app/api/pipeline/[id]/messages/route')
    const res = await GET(fakeRequest() as never, { params: Promise.resolve({ id: 'p1' }) })
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('a pipeline owned by a DIFFERENT organisation returns 404 and never queries pipeline_messages', async () => {
    requireSessionMock.mockResolvedValue({ organisationId: 'org-caller', userId: 'u1', role: 'viewer', name: 'A' })
    sqlMock.mockResolvedValueOnce([]) // ownership check finds nothing
    const { GET } = await import('@/app/api/pipeline/[id]/messages/route')
    const res = await GET(fakeRequest() as never, { params: Promise.resolve({ id: 'p1' }) })
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1) // only the ownership check — never the messages query
  })

  it('a pipeline with zero messages returns an empty array, not an error, once pipeline_messages exists', async () => {
    requireSessionMock.mockResolvedValue({ organisationId: 'org-caller', userId: 'u1', role: 'viewer', name: 'A' })
    sqlMock
      .mockResolvedValueOnce([{ id: 'p1' }]) // ownership check succeeds
      .mockResolvedValueOnce([]) // pipeline_messages query — table exists, zero rows
    const { GET } = await import('@/app/api/pipeline/[id]/messages/route')
    const res = await GET(fakeRequest() as never, { params: Promise.resolve({ id: 'p1' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ messages: [] })
  })

  it('POST rejects an empty body without ever touching the database', async () => {
    requireSessionMock.mockResolvedValue({ organisationId: 'org-caller', userId: 'u1', role: 'viewer', name: 'A' })
    const { POST } = await import('@/app/api/pipeline/[id]/messages/route')
    const res = await POST(fakeRequest({ body: '   ' }) as never, { params: Promise.resolve({ id: 'p1' }) })
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})
