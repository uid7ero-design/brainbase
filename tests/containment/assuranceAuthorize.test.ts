import { describe, it, expect, vi, beforeEach } from 'vitest'

// BrainBase Assurance — module access gate (session -> 'assurance'
// capability -> role floor). Mocks the two collaborators; asserts the
// organisation always comes from the DB-backed session.

const requireSession = vi.fn()
const checkCapability = vi.fn()

vi.mock('@/lib/org', () => ({
  requireSession: () => requireSession(),
  roleGte: (role: string, min: string) => {
    const order = ['viewer', 'manager', 'admin', 'super_admin']
    const a = order.indexOf(role), b = order.indexOf(min)
    return a !== -1 && b !== -1 && a >= b
  },
  unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  forbidden: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}))
vi.mock('@/lib/capabilities/requireCapability', () => ({
  checkCapability: (org: string, key: string) => checkCapability(org, key),
}))

const { authorizeAssuranceRequest, getAssurancePageAccess, ASSURANCE_CAPABILITY } = await import('@/lib/assurance/authorize')

const session = (role: string) => ({ userId: 'u1', organisationId: 'org-1', homeOrganisationId: 'org-1', role, name: 'U' })

beforeEach(() => {
  requireSession.mockReset()
  checkCapability.mockReset()
})

describe('authorizeAssuranceRequest', () => {
  it('401 without a session, and never checks the capability', async () => {
    requireSession.mockRejectedValue(new Error('Unauthorized'))
    const r = await authorizeAssuranceRequest('viewer')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(401)
    expect(checkCapability).not.toHaveBeenCalled()
  })
  it('403 when the organisation is not entitled to assurance', async () => {
    requireSession.mockResolvedValue(session('admin'))
    checkCapability.mockResolvedValue({ allowed: false, reason: 'NO_ENTITLEMENT' })
    const r = await authorizeAssuranceRequest('viewer')
    expect(!r.ok && r.response.status).toBe(403)
    expect(checkCapability).toHaveBeenCalledWith('org-1', 'assurance')
    expect(ASSURANCE_CAPABILITY).toBe('assurance')
  })
  it('503 when entitlement cannot be determined (fail closed, but distinguishable)', async () => {
    requireSession.mockResolvedValue(session('admin'))
    checkCapability.mockResolvedValue({ allowed: false, reason: 'DATABASE_ERROR' })
    const r = await authorizeAssuranceRequest('viewer')
    expect(!r.ok && r.response.status).toBe(503)
  })
  it('403 when the role is below the operation floor', async () => {
    requireSession.mockResolvedValue(session('viewer'))
    checkCapability.mockResolvedValue({ allowed: true, entitlement: { key: 'assurance', config: {} } })
    const r = await authorizeAssuranceRequest('manager')
    expect(!r.ok && r.response.status).toBe(403)
  })
  it('returns a viewer built only from the session', async () => {
    requireSession.mockResolvedValue(session('admin'))
    checkCapability.mockResolvedValue({ allowed: true, entitlement: { key: 'assurance', config: {} } })
    const r = await authorizeAssuranceRequest('manager')
    expect(r).toEqual({ ok: true, viewer: { organisationId: 'org-1', userId: 'u1', role: 'admin', canViewAllRestricted: true } })
  })
})

describe('getAssurancePageAccess', () => {
  it('distinguishes unauthenticated / not enabled / unavailable / ok', async () => {
    requireSession.mockRejectedValueOnce(new Error('Unauthorized'))
    expect(await getAssurancePageAccess()).toEqual({ status: 'unauthenticated' })

    requireSession.mockResolvedValue(session('manager'))
    checkCapability.mockResolvedValueOnce({ allowed: false, reason: 'CAPABILITY_INACTIVE' })
    expect(await getAssurancePageAccess()).toEqual({ status: 'not_enabled' })
    checkCapability.mockResolvedValueOnce({ allowed: false, reason: 'DATABASE_ERROR' })
    expect(await getAssurancePageAccess()).toEqual({ status: 'unavailable' })
    checkCapability.mockResolvedValueOnce({ allowed: true, entitlement: { key: 'assurance', config: {} } })
    expect(await getAssurancePageAccess()).toMatchObject({ status: 'ok', viewer: { organisationId: 'org-1', canViewAllRestricted: false } })
  })
  it('an unranked role (analyst) is treated as not enabled', async () => {
    requireSession.mockResolvedValue(session('analyst'))
    checkCapability.mockResolvedValue({ allowed: true, entitlement: { key: 'assurance', config: {} } })
    expect(await getAssurancePageAccess()).toEqual({ status: 'not_enabled' })
  })
})
