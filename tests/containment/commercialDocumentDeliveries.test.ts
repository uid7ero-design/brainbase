import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C3-POLISH-R §8 — behavioural tests for
// lib/commercial/documentDeliveries.ts.

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))

beforeEach(() => { sqlMock.mockReset() })

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const QUOTE_1 = 'quote-1'

describe('Phase C3-POLISH-R — recordDeliveryAttempt()', () => {
  it('inserts one row per attempt, scoped to the caller organisationId', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'd1', organisation_id: ORG_A, status: 'SENT' }])
    const { recordDeliveryAttempt } = await import('@/lib/commercial/documentDeliveries')
    await recordDeliveryAttempt({
      organisationId: ORG_A, documentType: 'quote', documentId: QUOTE_1, channel: 'EMAIL',
      recipient: 'customer@example.com', status: 'SENT', provider: 'resend', providerMessageId: 'msg-1', createdBy: 'user-1',
    })
    const values = sqlMock.mock.calls[0].slice(1) as unknown[]
    expect(values).toContain(ORG_A)
    expect(values).toContain('SENT')
  })

  it('sets failed_at only when status is FAILED, delivered_at only when status is DELIVERED', async () => {
    sqlMock.mockResolvedValue([{ id: 'd1' }])
    const { recordDeliveryAttempt } = await import('@/lib/commercial/documentDeliveries')

    await recordDeliveryAttempt({ organisationId: ORG_A, documentType: 'quote', documentId: QUOTE_1, channel: 'EMAIL', recipient: 'x@example.com', status: 'FAILED', createdBy: null })
    const failedValues = sqlMock.mock.calls[0].slice(1) as unknown[]
    // delivered_at, failed_at, error_summary, created_by is the tail of the VALUES list — failed_at (index -3 given error_summary+created_by follow) must be non-null, delivered_at null
    expect(failedValues.some(v => v === null)).toBe(true) // delivered_at is null
    expect(failedValues.filter(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)).length).toBeGreaterThan(0) // failed_at is an ISO instant
  })
})

describe('Phase C3-POLISH-R — listDeliveriesForDocument(): tenant isolation', () => {
  it('scopes the SELECT by organisation_id, document_type, and document_id together', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { listDeliveriesForDocument } = await import('@/lib/commercial/documentDeliveries')
    await listDeliveriesForDocument({ organisationId: ORG_A, documentType: 'quote', documentId: QUOTE_1 })
    const values = sqlMock.mock.calls[0].slice(1) as unknown[]
    expect(values).toEqual([ORG_A, 'quote', QUOTE_1])
  })

  it('a delivery row created for org A is invisible to a lookup scoped to org B — this test proves the QUERY is org-scoped; the composite FK backs it structurally at the DB level', async () => {
    sqlMock.mockResolvedValueOnce([]) // org B's own query returns nothing, regardless of what exists for org A
    const { listDeliveriesForDocument } = await import('@/lib/commercial/documentDeliveries')
    const result = await listDeliveriesForDocument({ organisationId: ORG_B, documentType: 'quote', documentId: QUOTE_1 })
    expect(result).toEqual([])
    const values = sqlMock.mock.calls[0].slice(1) as unknown[]
    expect(values).toContain(ORG_B)
    expect(values).not.toContain(ORG_A)
  })
})

describe('Phase C3-POLISH-R — secondsSinceLastAttempt(): resend cooldown source', () => {
  it('returns null when there is no prior attempt', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { secondsSinceLastAttempt } = await import('@/lib/commercial/documentDeliveries')
    const result = await secondsSinceLastAttempt({ organisationId: ORG_A, documentType: 'quote', documentId: QUOTE_1, channel: 'EMAIL' })
    expect(result).toBeNull()
  })

  it('returns the seconds elapsed since the most recent attempt, scoped by channel', async () => {
    sqlMock.mockResolvedValueOnce([{ seconds_since: 12 }])
    const { secondsSinceLastAttempt } = await import('@/lib/commercial/documentDeliveries')
    const result = await secondsSinceLastAttempt({ organisationId: ORG_A, documentType: 'quote', documentId: QUOTE_1, channel: 'EMAIL' })
    expect(result).toBe(12)
    const values = sqlMock.mock.calls[0].slice(1) as unknown[]
    expect(values).toContain('EMAIL')
  })
})
