import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C2 — lib/commercial/authorize.ts. Modeled directly on
// lib/debtors/authorize.ts's own established pattern (session ->
// capability -> role, additive, fail-closed). No production connection
// or data mutation — every dependency is mocked.

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: (...args: unknown[]) => requireCapabilityMock(...args) }
})

beforeEach(() => {
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
})

describe('Phase C2 — authorizeCommercialRequest (fail-closed composition)', () => {
  it('no session -> 401, never reaches the capability check', async () => {
    requireSessionMock.mockRejectedValue(new Error('no session'))
    const { authorizeCommercialRequest } = await import('@/lib/commercial/authorize')
    const result = await authorizeCommercialRequest('invoicing', 'viewer')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
    expect(requireCapabilityMock).not.toHaveBeenCalled()
  })

  it('session ok, capability denied (CapabilityAccessError) -> 403', async () => {
    requireSessionMock.mockResolvedValue({ organisationId: 'org-a', userId: 'u1', role: 'admin', name: 'A' })
    const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability')
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'))
    const { authorizeCommercialRequest } = await import('@/lib/commercial/authorize')
    const result = await authorizeCommercialRequest('invoicing', 'viewer')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
  })

  it('session ok, capability lookup fails (CapabilityDatabaseError) -> 503, distinguishable from an ordinary denial', async () => {
    requireSessionMock.mockResolvedValue({ organisationId: 'org-a', userId: 'u1', role: 'admin', name: 'A' })
    const { CapabilityDatabaseError } = await import('@/lib/capabilities/requireCapability')
    requireCapabilityMock.mockRejectedValue(new CapabilityDatabaseError())
    const { authorizeCommercialRequest } = await import('@/lib/commercial/authorize')
    const result = await authorizeCommercialRequest('invoicing', 'viewer')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(503)
  })

  it('session ok, capability granted, role BELOW minimum -> 403', async () => {
    requireSessionMock.mockResolvedValue({ organisationId: 'org-a', userId: 'u1', role: 'viewer', name: 'A' })
    requireCapabilityMock.mockResolvedValue({ key: 'invoicing', config: {} })
    const { authorizeCommercialRequest } = await import('@/lib/commercial/authorize')
    const result = await authorizeCommercialRequest('invoicing', 'manager')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
  })

  it('session ok, capability granted, role AT OR ABOVE minimum -> success, returns the session', async () => {
    requireSessionMock.mockResolvedValue({ organisationId: 'org-a', userId: 'u1', role: 'admin', name: 'A' })
    requireCapabilityMock.mockResolvedValue({ key: 'invoicing', config: {} })
    const { authorizeCommercialRequest } = await import('@/lib/commercial/authorize')
    const result = await authorizeCommercialRequest('invoicing', 'manager')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.session.organisationId).toBe('org-a')
  })

  it('the requested capability key is passed through exactly — a route for "purchasing" never accidentally checks "invoicing"', async () => {
    requireSessionMock.mockResolvedValue({ organisationId: 'org-a', userId: 'u1', role: 'admin', name: 'A' })
    requireCapabilityMock.mockResolvedValue({ key: 'purchasing', config: {} })
    const { authorizeCommercialRequest } = await import('@/lib/commercial/authorize')
    await authorizeCommercialRequest('purchasing', 'viewer')
    expect(requireCapabilityMock).toHaveBeenCalledWith('org-a', 'purchasing')
  })
})

describe('Phase C2 — COMMERCIAL_MIN_ROLE reusable defaults', () => {
  it('view <= createEdit <= approve == administer, matching the four operation classes named in the C2 brief', async () => {
    const { COMMERCIAL_MIN_ROLE } = await import('@/lib/commercial/authorize')
    const { ROLE_ORDER } = await import('@/lib/session')
    const idx = (r: string) => ROLE_ORDER.indexOf(r as never)
    expect(idx(COMMERCIAL_MIN_ROLE.view)).toBeLessThanOrEqual(idx(COMMERCIAL_MIN_ROLE.createEdit))
    expect(idx(COMMERCIAL_MIN_ROLE.createEdit)).toBeLessThanOrEqual(idx(COMMERCIAL_MIN_ROLE.approve))
    expect(COMMERCIAL_MIN_ROLE.administer).toBe(COMMERCIAL_MIN_ROLE.approve)
  })

  it('administer is never super_admin (that role is reserved for cross-organisation BrainBase staff, not an organisation’s own top-level user)', async () => {
    const { COMMERCIAL_MIN_ROLE } = await import('@/lib/commercial/authorize')
    expect(COMMERCIAL_MIN_ROLE.administer).not.toBe('super_admin')
  })
})
