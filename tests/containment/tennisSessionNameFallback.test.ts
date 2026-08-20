import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

function asNextRequest(url: string, body?: unknown): NextRequest {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as unknown as NextRequest
}

const requireRoleMock = vi.fn()
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}))

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}))

const reconcileMock = vi.fn()
vi.mock('@/lib/tennisSchedule', () => ({
  reconcileFutureInstances: (...args: unknown[]) => reconcileMock(...args),
}))

const { POST } = await import('@/app/api/dashboard/sessions/route')

const manager = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' }

describe('POST /api/dashboard/sessions — Session Type is primary, Optional Label is no longer required', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset(); reconcileMock.mockReset() })

  it('creating a session with no name/label at all succeeds — day_of_week, start_time, session_type are the only requirements now', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join('')
      if (text.includes('SELECT name FROM session_types')) return Promise.resolve([{ name: 'Hot Shots Tennis' }])
      if (text.includes('INSERT INTO sessions')) return Promise.resolve([{ id: 'sess-1', day_of_week: 1, start_time: '10:00', duration_minutes: 60, max_capacity: 8, session_type: 'GROUP_TERM_JUNIOR', name: 'Hot Shots Tennis', start_date: null, end_mode: 'ongoing', end_after_weeks: null, end_date: null }])
      return Promise.resolve([])
    })
    reconcileMock.mockResolvedValue({ generated: 0, reactivated: 0, cancelledInstances: 0, conflicts: [] })

    const res = await POST(asNextRequest('http://localhost/api/dashboard/sessions', {
      day_of_week: 1, start_time: '10:00', session_type: 'GROUP_TERM_JUNIOR',
    }))
    expect(res.status).toBe(201)
  })

  it('a blank name falls back deterministically to the resolved session_types display name for that org+slug', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join('')
      if (text.includes('SELECT name FROM session_types')) return Promise.resolve([{ name: 'Cardio Tennis (Term)' }])
      if (text.includes('INSERT INTO sessions')) return Promise.resolve([{ id: 'sess-1', name: 'Cardio Tennis (Term)' }])
      return Promise.resolve([])
    })
    reconcileMock.mockResolvedValue({ generated: 0, reactivated: 0, cancelledInstances: 0, conflicts: [] })

    await POST(asNextRequest('http://localhost/api/dashboard/sessions', {
      name: '   ', day_of_week: 5, start_time: '09:00', session_type: 'CARDIO_TERM',
    }))
    const insertCall = sqlMock.mock.calls.find(c => (c[0] as string[]).join('').includes('INSERT INTO sessions'))
    expect(insertCall).toContain('Cardio Tennis (Term)')
  })

  it('a blank name for a type with no session_types row falls back to the raw slug, not an error — deterministic even pre-migration', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join('')
      if (text.includes('SELECT name FROM session_types')) return Promise.resolve([]) // no match
      if (text.includes('INSERT INTO sessions')) return Promise.resolve([{ id: 'sess-1', name: 'BRAND_NEW_SLUG' }])
      return Promise.resolve([])
    })
    reconcileMock.mockResolvedValue({ generated: 0, reactivated: 0, cancelledInstances: 0, conflicts: [] })

    const res = await POST(asNextRequest('http://localhost/api/dashboard/sessions', {
      day_of_week: 2, start_time: '11:00', session_type: 'BRAND_NEW_SLUG',
    }))
    expect(res.status).toBe(201)
    const insertCall = sqlMock.mock.calls.find(c => (c[0] as string[]).join('').includes('INSERT INTO sessions'))
    expect(insertCall).toContain('BRAND_NEW_SLUG')
  })

  it('an explicitly provided non-empty name is used verbatim, not overridden by the type fallback', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join('')
      if (text.includes('INSERT INTO sessions')) return Promise.resolve([{ id: 'sess-1', name: 'Green Ball Advanced' }])
      return Promise.resolve([])
    })
    reconcileMock.mockResolvedValue({ generated: 0, reactivated: 0, cancelledInstances: 0, conflicts: [] })

    await POST(asNextRequest('http://localhost/api/dashboard/sessions', {
      name: 'Green Ball Advanced', day_of_week: 1, start_time: '10:00', session_type: 'GROUP_TERM_JUNIOR',
    }))
    // The type lookup should never even run — an explicit name short-circuits it.
    const typeLookup = sqlMock.mock.calls.find(c => (c[0] as string[]).join('').includes('SELECT name FROM session_types'))
    expect(typeLookup).toBeUndefined()
    const insertCall = sqlMock.mock.calls.find(c => (c[0] as string[]).join('').includes('INSERT INTO sessions'))
    expect(insertCall).toContain('Green Ball Advanced')
  })

  it('still rejects a request missing session_type — that requirement is unchanged', async () => {
    requireRoleMock.mockResolvedValue(manager)
    const res = await POST(asNextRequest('http://localhost/api/dashboard/sessions', {
      day_of_week: 1, start_time: '10:00', session_type: '',
    }))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})
