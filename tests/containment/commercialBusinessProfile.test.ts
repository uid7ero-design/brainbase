import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C3-POLISH-R §1/§2 — behavioural tests for
// lib/commercial/businessProfile.ts.

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))

beforeEach(() => { sqlMock.mockReset() })

const ORG_A = 'org-a'

describe('Phase C3-POLISH-R — getBusinessProfile()', () => {
  it('returns null if the organisation does not exist', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { getBusinessProfile } = await import('@/lib/commercial/businessProfile')
    expect(await getBusinessProfile(ORG_A)).toBeNull()
  })

  it('falls back to an all-null profile when settings has no commercial.businessProfile key at all — every field is genuinely optional', async () => {
    sqlMock.mockResolvedValueOnce([{ name: 'Acme Pty Ltd', settings: {} }])
    const { getBusinessProfile } = await import('@/lib/commercial/businessProfile')
    const result = await getBusinessProfile(ORG_A)
    expect(result?.organisationName).toBe('Acme Pty Ltd')
    expect(result?.profile).toEqual({ tradingName: null, address: null, email: null, phone: null, abn: null })
  })

  it('reads a previously-configured profile back verbatim', async () => {
    sqlMock.mockResolvedValueOnce([{
      name: 'Acme Pty Ltd',
      settings: { commercial: { businessProfile: { tradingName: 'Acme Trading', address: '1 Main St', email: 'hi@acme.com', phone: '08 1234 5678', abn: '12 345 678 901' } } },
    }])
    const { getBusinessProfile } = await import('@/lib/commercial/businessProfile')
    const result = await getBusinessProfile(ORG_A)
    expect(result?.profile.tradingName).toBe('Acme Trading')
    expect(result?.profile.abn).toBe('12 345 678 901')
  })

  it('tolerates a garbage/non-object businessProfile value rather than throwing', async () => {
    sqlMock.mockResolvedValueOnce([{ name: 'Acme', settings: { commercial: { businessProfile: 'not-an-object' } } }])
    const { getBusinessProfile } = await import('@/lib/commercial/businessProfile')
    const result = await getBusinessProfile(ORG_A)
    expect(result?.profile).toEqual({ tradingName: null, address: null, email: null, phone: null, abn: null })
  })
})

describe('Phase C3-POLISH-R — setBusinessProfile()', () => {
  it('reads current settings, merges the commercial key, and writes it back scoped to this organisation', async () => {
    sqlMock
      .mockResolvedValueOnce([{ settings: { someOtherFeature: { flag: true }, commercial: { unrelatedKey: 'keepme' } } }])
      .mockResolvedValueOnce([])
    const { setBusinessProfile } = await import('@/lib/commercial/businessProfile')
    await setBusinessProfile(ORG_A, { tradingName: 'New Name', address: null, email: null, phone: null, abn: null })

    const updateCall = sqlMock.mock.calls[1]
    const values = updateCall.slice(1) as unknown[]
    const mergedJson = values.find(v => typeof v === 'string' && v.includes('New Name')) as string
    expect(mergedJson).toBeDefined()
    const merged = JSON.parse(mergedJson)
    expect(merged.unrelatedKey).toBe('keepme') // never clobbers an unrelated existing key under settings.commercial
    expect(merged.businessProfile.tradingName).toBe('New Name')
    expect(values).toContain(ORG_A)
  })

  it('trims blank-string fields to null rather than persisting whitespace', async () => {
    sqlMock.mockResolvedValueOnce([{ settings: {} }]).mockResolvedValueOnce([])
    const { setBusinessProfile } = await import('@/lib/commercial/businessProfile')
    await setBusinessProfile(ORG_A, { tradingName: '   ', address: 'Real Address', email: null, phone: null, abn: null })
    const updateCall = sqlMock.mock.calls[1]
    const values = updateCall.slice(1) as unknown[]
    const mergedJson = values.find(v => typeof v === 'string' && v.includes('Real Address')) as string
    const merged = JSON.parse(mergedJson)
    expect(merged.businessProfile.tradingName).toBeNull()
    expect(merged.businessProfile.address).toBe('Real Address')
  })
})
