import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// POST /api/tennis/book reads process.env.LD_TENNIS_ORG_ID at module load
// time (`const ORG_ID = process.env.LD_TENNIS_ORG_ID`), so it must be set
// before the dynamic import below.
process.env.LD_TENNIS_ORG_ID = 'ld-tennis-org-id'

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

const rateLimitMock = vi.fn<(...args: unknown[]) => boolean>(() => true)
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: (...args: unknown[]) => rateLimitMock(...args),
}))

type SqlCall = { text: string; values: unknown[] }
let sqlCalls: SqlCall[] = []
let pipelineInsertShouldFail = false

const INSTANCE_ROW = {
  id: 'inst-1', session_id: 'sess-1', date: '2026-08-25', start_time: '10:00',
  duration_minutes: 60, max_capacity: 4,
  session_name: 'Private Lesson', session_type: 'private',
}

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('')
  sqlCalls.push({ text, values })

  if (text.includes('FROM session_instances si')) {
    return Promise.resolve([INSTANCE_ROW])
  }
  if (text.includes('SELECT COUNT(*)::int AS count FROM bookings')) {
    return Promise.resolve([{ count: 0 }])
  }
  if (text.includes('SELECT id FROM bookings')) {
    return Promise.resolve([]) // no existing duplicate booking
  }
  if (text.includes('INSERT INTO client_pipeline')) {
    // This is the exact statement that threw NeonDbError 42703
    // ("column \"submitted_by_name\" of relation \"client_pipeline\" does
    // not exist") in Production before this fix.
    if (pipelineInsertShouldFail) return Promise.reject(new Error('client_pipeline insert failed'))
    return Promise.resolve([])
  }
  if (text.includes('INSERT INTO bookings (')) {
    return Promise.resolve([])
  }
  if (text.includes('INSERT INTO pipeline_messages')) {
    return Promise.resolve([])
  }
  return Promise.resolve([])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const { POST } = await import('@/app/api/tennis/book/route')

beforeEach(() => {
  sqlCalls = []
  pipelineInsertShouldFail = false
  sqlMock.mockClear()
  rateLimitMock.mockReset().mockReturnValue(true)
})

function jsonRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/tennis/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

const VALID_BODY = {
  session_instance_id: 'inst-1', name: 'Jamie Client', email: 'jamie@example.com', phone: '0400000000',
}

function callsMatching(pattern: string): SqlCall[] {
  return sqlCalls.filter(c => c.text.includes(pattern))
}

describe('POST /api/tennis/book — the Production-blocking 42703 error is fixed', () => {
  it('no longer references submitted_by_name in the client_pipeline INSERT column list', async () => {
    await POST(jsonRequest(VALID_BODY))
    const [call] = callsMatching('INSERT INTO client_pipeline')
    const columnListMatch = call.text.match(/INSERT INTO client_pipeline\s*\(([^)]*)\)/)
    expect(columnListMatch).not.toBeNull()
    expect(columnListMatch![1]).not.toContain('submitted_by_name')
  })

  it('a booking request that previously failed with a 500 on the missing column now succeeds end-to-end', async () => {
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.booking.session_name).toBe('Private Lesson')
  })

  it('the booker name — previously carried in the now-removed submitted_by_name column — is preserved in the description instead', async () => {
    await POST(jsonRequest(VALID_BODY))
    const [call] = callsMatching('INSERT INTO client_pipeline')
    // values order (${}-interpolated only): id, organisation_id, title, description
    const description = call.values[3] as string
    expect(description).toContain('Jamie Client')
  })

  it('the pipeline row still uses the same server-side LD Tennis organisation id', async () => {
    await POST(jsonRequest(VALID_BODY))
    const [call] = callsMatching('INSERT INTO client_pipeline')
    expect(call.values[1]).toBe('ld-tennis-org-id')
  })

  it('still creates exactly one client_pipeline row, one booking, and one pipeline_messages row per request', async () => {
    await POST(jsonRequest(VALID_BODY))
    expect(callsMatching('INSERT INTO client_pipeline')).toHaveLength(1)
    expect(callsMatching('INSERT INTO bookings (')).toHaveLength(1)
    expect(callsMatching('INSERT INTO pipeline_messages')).toHaveLength(1)
  })

  it('a client_pipeline failure still fails the booking as a whole (pre-existing behaviour, unchanged by this fix)', async () => {
    pipelineInsertShouldFail = true
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Failed to create booking')
    // No booking or pipeline_messages row is created when the pipeline insert throws
    expect(callsMatching('INSERT INTO bookings (')).toHaveLength(0)
    expect(callsMatching('INSERT INTO pipeline_messages')).toHaveLength(0)

    errorSpy.mockRestore()
  })
})
