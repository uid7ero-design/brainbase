import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C3-POLISH-R §4 — behavioural tests for
// lib/commercial/taxCodeBootstrap.ts.

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))

beforeEach(() => { sqlMock.mockReset() })

const ORG_A = 'org-a'

describe('Phase C3-POLISH-R — seedStandardAustralianTaxCodes()', () => {
  it('inserts exactly the three standard codes: GST 10%, GST Free, No Tax', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 't1', code: 'GST', name: 'GST 10%', rate: '10.00', is_default: true }])
      .mockResolvedValueOnce([{ id: 't2', code: 'GST_FREE', name: 'GST Free', rate: '0.00', is_default: false }])
      .mockResolvedValueOnce([{ id: 't3', code: 'NO_TAX', name: 'No Tax', rate: '0.00', is_default: false }])

    const { seedStandardAustralianTaxCodes } = await import('@/lib/commercial/taxCodeBootstrap')
    const result = await seedStandardAustralianTaxCodes(ORG_A)

    expect(result.created.map(c => c.code)).toEqual(['GST', 'GST_FREE', 'NO_TAX'])
    expect(result.skipped).toEqual([])
    expect(sqlMock).toHaveBeenCalledTimes(3)
  })

  it('GST defaults to 10.00% and is_default=true; GST Free and No Tax are both 0.00% but distinct codes', async () => {
    sqlMock.mockResolvedValue([])
    const { STANDARD_AU_TAX_CODES } = await import('@/lib/commercial/taxCodeBootstrap')
    const gst = STANDARD_AU_TAX_CODES.find(c => c.code === 'GST')!
    const gstFree = STANDARD_AU_TAX_CODES.find(c => c.code === 'GST_FREE')!
    const noTax = STANDARD_AU_TAX_CODES.find(c => c.code === 'NO_TAX')!
    expect(gst.rate).toBe(10.0)
    expect(gst.isDefault).toBe(true)
    expect(gstFree.rate).toBe(0)
    expect(noTax.rate).toBe(0)
    expect(gstFree.code).not.toBe(noTax.code)
  })

  it('is idempotent: re-running on an org that already has all three codes creates nothing and reports them as skipped', async () => {
    sqlMock.mockResolvedValue([]) // ON CONFLICT DO NOTHING -> RETURNING * -> empty rows every time
    const { seedStandardAustralianTaxCodes } = await import('@/lib/commercial/taxCodeBootstrap')
    const result = await seedStandardAustralianTaxCodes(ORG_A)
    expect(result.created).toEqual([])
    expect(result.skipped).toEqual(['GST', 'GST_FREE', 'NO_TAX'])
  })

  it('a partial pre-existing state (one code already present) creates only the missing two', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // GST already exists -> ON CONFLICT DO NOTHING
      .mockResolvedValueOnce([{ id: 't2', code: 'GST_FREE' }])
      .mockResolvedValueOnce([{ id: 't3', code: 'NO_TAX' }])
    const { seedStandardAustralianTaxCodes } = await import('@/lib/commercial/taxCodeBootstrap')
    const result = await seedStandardAustralianTaxCodes(ORG_A)
    expect(result.skipped).toEqual(['GST'])
    expect(result.created.map((c: { code: string }) => c.code)).toEqual(['GST_FREE', 'NO_TAX'])
  })

  it('every INSERT is scoped to the caller-supplied organisationId — never a global/platform-wide seed', async () => {
    sqlMock.mockResolvedValue([])
    const { seedStandardAustralianTaxCodes } = await import('@/lib/commercial/taxCodeBootstrap')
    await seedStandardAustralianTaxCodes('org-specific-123')
    for (const call of sqlMock.mock.calls) {
      const values = call.slice(1)
      expect(values).toContain('org-specific-123')
    }
  })
})
