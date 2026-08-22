import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// ── PATCH /api/web-services/leads/[id]: business_type survives an edit ──────

const getAuthSessionMock = vi.fn()
vi.mock('@/lib/authSession', () => ({
  getAuthSession: (...args: unknown[]) => getAuthSessionMock(...args),
}))

type SqlCall = { text: string; values: unknown[] }
let sqlCalls: SqlCall[] = []
let updateResult: Array<Record<string, unknown>> = []

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('')
  sqlCalls.push({ text, values })
  if (text.includes('UPDATE web_service_leads')) return Promise.resolve(updateResult)
  return Promise.resolve([])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const { PATCH } = await import('@/app/api/web-services/leads/[id]/route')

beforeEach(() => {
  sqlCalls = []
  updateResult = []
  sqlMock.mockClear()
  getAuthSessionMock.mockReset()
})

function patchRequest(body: unknown): Request {
  return new Request('http://localhost/api/web-services/leads/lead-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function params(id = 'lead-1') {
  return { params: Promise.resolve({ id }) }
}

describe('PATCH /api/web-services/leads/[id] — business_type is no longer dropped', () => {
  it('the RETURNING clause selects business_type', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-1' })
    updateResult = [{
      id: 'lead-1', full_name: 'Jamie Client', business_type: 'Coaching studio', status: 'contacted',
    }]

    const res = await PATCH(patchRequest({ status: 'contacted' }), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.lead.business_type).toBe('Coaching studio')

    const [call] = sqlCalls.filter(c => c.text.includes('UPDATE web_service_leads'))
    expect(call.text).toContain('business_type')
  })
})

// ── Kanban layout + contact actions + business_type display — static checks ─
// The admin page is a large client component with no existing test
// coverage; these are scoped, targeted source assertions for the specific
// changes made here, matching the static-check convention already used
// elsewhere in this test suite (e.g. tennisSessionDisplayStaticCheck.test.ts).

describe('app/admin/web-services/page.tsx — kanban horizontal scroll fix', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app/admin/web-services/page.tsx'), 'utf-8')

  it('no longer forces the kanban row to a full-viewport minHeight (the root cause of the off-screen scrollbar)', () => {
    expect(source).not.toContain("minHeight: 'calc(100vh - 150px)'")
  })

  it('the kanban row still scrolls horizontally', () => {
    expect(source).toContain("overflowX: 'auto'")
  })

  it('all 10 kanban stages are still intact — no column was removed', () => {
    const statusMatches = source.match(/status: '(new|discovery|qualified|proposal_sent|proposal_approved|onboarding|in_deployment|active_client|paused|lost)'/g) ?? []
    expect(statusMatches).toHaveLength(10)
  })

  it('adds a visible (not hover-only) scrollbar style, scoped to the kanban row only', () => {
    expect(source).toContain('wsp-kanban-scroll')
    expect(source).toContain('::-webkit-scrollbar')
    expect(source).toContain('scrollbar-width: thin')
  })
})

describe('app/admin/web-services/page.tsx — contact actions are now clickable', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app/admin/web-services/page.tsx'), 'utf-8')

  it('lead email is a mailto: link', () => {
    expect(source).toMatch(/href=\{`mailto:\$\{lead\.email\}`\}/)
  })

  it('lead phone is a tel: link', () => {
    expect(source).toMatch(/href=\{`tel:\$\{lead\.phone\}`\}/)
  })

  it('displayed values are preserved (not replaced by placeholder text)', () => {
    expect(source).toMatch(/mailto:\$\{lead\.email\}`\}[^]*?\{lead\.email\}/)
  })
})

describe('app/admin/web-services/page.tsx — business_type is now displayed', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app/admin/web-services/page.tsx'), 'utf-8')

  it('renders a Business Type field when present', () => {
    expect(source).toContain('Business Type')
    expect(source).toContain('lead.business_type')
  })

  it('the WebLead interface already declared business_type (confirms this was a display/response gap, not a missing field)', () => {
    expect(source).toMatch(/business_type:\s*string \| null;/)
  })
})

describe('Scope boundaries — LD Tennis and Requests/client_pipeline are untouched by this branch', () => {
  it('app/api/web-services/lead/route.ts never reads LD_TENNIS_ORG_ID or writes client_pipeline', () => {
    // Scoped to actual usage, not a blanket string ban — the route's
    // existing resolveEmailConfig(null) comment (from the earlier
    // fix/strategy-call-email-delivery PR) legitimately names
    // LD_TENNIS_ORG_ID when explaining why that branch is unreachable here.
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/web-services/lead/route.ts'), 'utf-8')
    expect(source).not.toContain('process.env.LD_TENNIS_ORG_ID')
    expect(source).not.toMatch(/(FROM|INTO|UPDATE)\s+client_pipeline/)
  })

  it('LD Tennis routes are untouched', () => {
    const lead = fs.readFileSync(path.resolve(__dirname, '../../app/api/lead/route.ts'), 'utf-8')
    const leadsId = fs.readFileSync(path.resolve(__dirname, '../../app/api/leads/[id]/route.ts'), 'utf-8')
    const book = fs.readFileSync(path.resolve(__dirname, '../../app/api/tennis/book/route.ts'), 'utf-8')
    expect(lead).not.toContain('brainbase_web_services_lead')
    expect(leadsId).not.toContain('brainbase_web_services_lead')
    expect(book).not.toContain('brainbase_web_services_lead')
  })
})
