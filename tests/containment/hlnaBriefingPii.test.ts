import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

const routeSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/hlna/briefing/route.ts'), 'utf-8')

// Top-level, per vi.mock's hoisting contract — a vi.mock nested inside a
// describe() block is hoisted above the whole file anyway, but only
// warning-free (and reliably ordered relative to other top-level mocks)
// when it's written at the top level to begin with.
const getAuthSessionMock = vi.fn()
vi.mock('@/lib/authSession', () => ({ getAuthSession: () => getAuthSessionMock() }))

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({ default: (...args: unknown[]) => sqlMock(...args) }))

describe('2. static guarantee — email/phone/address can never enter the briefing prompt from the contacts snapshot', () => {
  it('the attentionRows query only ever selects last_contacted_at — no name/email/phone/address column', () => {
    const queryStart = routeSource.indexOf('SELECT last_contacted_at')
    expect(queryStart).toBeGreaterThan(-1)
    const queryBlock = routeSource.slice(queryStart, routeSource.indexOf('LIMIT 1', queryStart) + 10)
    expect(queryBlock).not.toMatch(/\bname\b/)
    expect(queryBlock).not.toMatch(/\bemail\b/)
    expect(queryBlock).not.toMatch(/\bphone\b/)
    expect(queryBlock).not.toMatch(/\baddress\b/)
  })

  it('tennisSnapshot no longer builds an "Overdue follow-ups: <name list>" line', () => {
    const fnStart = routeSource.indexOf('async function tennisSnapshot(')
    const fnEnd = routeSource.indexOf('\nconst MODULE_SNAPSHOTS')
    const body = routeSource.slice(fnStart, fnEnd)
    expect(body).not.toContain('Overdue follow-ups: ${attention}')
    expect(body).not.toContain('.map(r => r.name)')
  })

  it('3. an aggregate age/urgency signal replaces the removed name list — the briefing is not made useless by removing PII', () => {
    const fnStart = routeSource.indexOf('async function tennisSnapshot(')
    const fnEnd = routeSource.indexOf('\nconst MODULE_SNAPSHOTS')
    const body = routeSource.slice(fnStart, fnEnd)
    expect(body).toContain('oldestAge')
    expect(body).toContain('since last contact')
    // The pre-existing count/status aggregate line is untouched.
    expect(body).toContain('${t.needs_attention} contact')
  })

  it('the other module snapshots (waste/fleet/service-requests) were already aggregate-only and are untouched by this round', () => {
    expect(routeSource).toContain('async function wasteSnapshot(')
    expect(routeSource).toContain('async function fleetSnapshot(')
    expect(routeSource).toContain('async function srSnapshot(')
    // None of them ever selected a contact/person name column.
    const wasteStart = routeSource.indexOf('async function wasteSnapshot(')
    const wasteEnd = routeSource.indexOf('\nasync function fleetSnapshot(')
    expect(routeSource.slice(wasteStart, wasteEnd)).not.toMatch(/\bname\b/)
  })
})

describe('4. tenant scope is unchanged', () => {
  it('every contacts/tennis_leads query in tennisSnapshot remains scoped by organisation_id', () => {
    const fnStart = routeSource.indexOf('async function tennisSnapshot(')
    const fnEnd = routeSource.indexOf('\nconst MODULE_SNAPSHOTS')
    const body = routeSource.slice(fnStart, fnEnd)
    const scopedCount = (body.match(/organisation_id = \$\{oid\}/g) ?? []).length
    expect(scopedCount).toBeGreaterThanOrEqual(3) // contactStats, attentionRows, leadsRows
  })
})

describe('5/6. response shape and fallback are unchanged — the dashboard/HlnaInsightCard needs no changes', () => {
  it('the success response still returns the same fields the UI already reads', () => {
    expect(routeSource).toContain('greeting,')
    expect(routeSource).toContain('lines:       parsed.lines')
    expect(routeSource).toContain('urgentCount: parsed.urgentCount')
    expect(routeSource).toContain('summary:     parsed.summary')
    expect(routeSource).toContain('hasData:     true,')
  })

  it('fallback() is untouched and still returns the same safe empty shape', () => {
    expect(routeSource).toContain("function fallback(greeting: string, reason: string)")
    expect(routeSource).toContain('hasData:     false,')
  })
})

describe('1. real execution — the actual OpenAI prompt payload contains no contact name', () => {
  const realFetch = global.fetch
  const ORIGINAL_LD_TENNIS_ORG_ID = process.env.LD_TENNIS_ORG_ID
  const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY

  const FAKE_NAME = 'Zzyzx Testperson' // distinctive — would only appear if a name field leaked through

  beforeEach(() => {
    getAuthSessionMock.mockReset()
    sqlMock.mockReset()
    process.env.LD_TENNIS_ORG_ID = 'org-under-test'
    process.env.OPENAI_API_KEY = 'sk-test-fake-key'
  })

  afterEach(() => {
    global.fetch = realFetch
    if (ORIGINAL_LD_TENNIS_ORG_ID === undefined) delete process.env.LD_TENNIS_ORG_ID
    else process.env.LD_TENNIS_ORG_ID = ORIGINAL_LD_TENNIS_ORG_ID
    if (ORIGINAL_OPENAI_KEY === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY
  })

  it('a name field present in the raw query result (as it would have been pre-fix) never reaches the OpenAI request body, because the code no longer reads it', async () => {
    getAuthSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-under-test', role: 'manager', name: 'Luke', email: 'luke@example.com' })

    sqlMock
      .mockResolvedValueOnce([{ total: 5, active_count: 2, lead_count: 2, inactive_count: 1, needs_attention: 2 }]) // contactStats
      .mockResolvedValueOnce([{ name: FAKE_NAME, last_contacted_at: new Date(Date.now() - 9 * 86400000).toISOString() }]) // attentionRows (name present in the row shape, but the code must not read it)
      .mockResolvedValueOnce([{ pending: 1 }]) // leadsRows

    let capturedOpenAiBody: string | null = null
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = url.toString()
      if (href.includes('open-meteo')) {
        return new Response(JSON.stringify({ daily: { time: ['2026-01-01'], precipitation_probability_max: [10] } }), { status: 200 })
      }
      if (href.includes('openai.com')) {
        capturedOpenAiBody = init?.body as string
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ lines: ['a', 'b', 'c', 'd'], urgentCount: 1, summary: 'ok' }) } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const { POST } = await import('@/app/api/hlna/briefing/route')
    const res = await POST()
    expect(res.status).toBe(200)

    expect(capturedOpenAiBody).not.toBeNull()
    expect(capturedOpenAiBody as unknown as string).not.toContain(FAKE_NAME)
    // The aggregate age signal (derived from last_contacted_at, not name)
    // should still be present, proving the briefing kept useful context.
    expect(capturedOpenAiBody as unknown as string).toMatch(/day\(s\) since last contact|9 day/)
  })
})
