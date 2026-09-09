import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C4.3B — dedicated proof that document/tenant integrity for
// commercial_document_deliveries WRITES is a real, enforced application
// invariant, not merely a convention, now that the DB-level composite
// FK onto commercial_quotes has been dropped (see
// scripts/widen-commercial-document-deliveries-for-invoices.sql and
// lib/commercial/documentDeliveries.ts's own header comment for why).
//
// Complements (does not duplicate):
//  - tests/containment/commercialDocumentDeliveries.test.ts, which
//    proves the raw insert primitive is not exported at all.
//  - tests/containment/commercialQuoteSendEmailRoute.test.ts /
//    commercialInvoiceSendEmailRoute.test.ts, which prove each route
//    always resolves its own document via a tenant-scoped domain lookup
//    (getQuoteWithLines(session.organisationId, id) /
//    getInvoiceWithLines(session.organisationId, id)) BEFORE ever
//    calling the delivery-recording function.
//
// This file proves the LAST line of defence: even if a caller somehow
// obtained a resolved document object that does not actually belong to
// the organisationId it claims, the write is refused loudly rather than
// silently accepted.

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))

beforeEach(() => { sqlMock.mockReset() })

const { recordQuoteDeliveryAttempt, recordInvoiceDeliveryAttempt } = await import('@/lib/commercial/documentDeliveries')

describe('Phase C4.3B — quote send resolves the quote tenant-safely before any delivery write', () => {
  it('a quote object whose organisation_id matches the caller organisationId writes successfully', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'd1', organisation_id: 'org-a', document_type: 'quote' }])
    await expect(recordQuoteDeliveryAttempt({
      organisationId: 'org-a', quote: { id: 'q1', organisation_id: 'org-a' },
      channel: 'EMAIL', recipient: 'x@example.com', status: 'SENT', createdBy: 'user-1',
    })).resolves.toBeDefined()
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('CONFIRMED DEFECT CLASS, NOW CLOSED: a quote object claiming to belong to org-a but actually tagged org-b throws BEFORE any SQL is issued — no delivery row is ever written for a wrong-tenant document', async () => {
    await expect(recordQuoteDeliveryAttempt({
      organisationId: 'org-a', quote: { id: 'q1', organisation_id: 'org-b' },
      channel: 'EMAIL', recipient: 'x@example.com', status: 'SENT', createdBy: 'user-1',
    })).rejects.toThrow(/Tenant mismatch/)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('Phase C4.3B — invoice send resolves the invoice tenant-safely before any delivery write', () => {
  it('an invoice object whose organisation_id matches the caller organisationId writes successfully', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'd1', organisation_id: 'org-a', document_type: 'invoice' }])
    await expect(recordInvoiceDeliveryAttempt({
      organisationId: 'org-a', invoice: { id: 'inv1', organisation_id: 'org-a' },
      channel: 'EMAIL', recipient: 'x@example.com', status: 'SENT', createdBy: 'user-1',
    })).resolves.toBeDefined()
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('a hostile/wrong-tenant invoice id (organisation_id tagged org-b, caller claims org-a) throws before any SQL is issued', async () => {
    await expect(recordInvoiceDeliveryAttempt({
      organisationId: 'org-a', invoice: { id: 'inv1', organisation_id: 'org-b' },
      channel: 'EMAIL', recipient: 'x@example.com', status: 'SENT', createdBy: 'user-1',
    })).rejects.toThrow(/Tenant mismatch/)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('the reverse direction also fails: caller claims org-b, invoice actually belongs to org-a', async () => {
    await expect(recordInvoiceDeliveryAttempt({
      organisationId: 'org-b', invoice: { id: 'inv1', organisation_id: 'org-a' },
      channel: 'EMAIL', recipient: 'x@example.com', status: 'SENT', createdBy: 'user-1',
    })).rejects.toThrow(/Tenant mismatch/)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('Phase C4.3B — document type and resolved document type cannot be mismatched', () => {
  it('recordQuoteDeliveryAttempt() always writes document_type=\'quote\' — a caller cannot pass any other type, because there is no documentType parameter on this function at all (it is hardcoded internally, not caller-suppliable)', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'd1' }])
    await recordQuoteDeliveryAttempt({
      organisationId: 'org-a', quote: { id: 'q1', organisation_id: 'org-a' },
      channel: 'EMAIL', recipient: 'x@example.com', status: 'SENT', createdBy: 'user-1',
    })
    const values = sqlMock.mock.calls[0].slice(1) as unknown[]
    expect(values).toContain('quote')
    expect(values).not.toContain('invoice')
  })

  it('recordInvoiceDeliveryAttempt() always writes document_type=\'invoice\', symmetrically', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'd1' }])
    await recordInvoiceDeliveryAttempt({
      organisationId: 'org-a', invoice: { id: 'inv1', organisation_id: 'org-a' },
      channel: 'EMAIL', recipient: 'x@example.com', status: 'SENT', createdBy: 'user-1',
    })
    const values = sqlMock.mock.calls[0].slice(1) as unknown[]
    expect(values).toContain('invoice')
    expect(values).not.toContain('quote')
  })

  it('neither exported function accepts a documentType parameter at all — TypeScript itself rejects a caller attempt to override it (compile-time proof, verified by grepping the module\'s own exported parameter shape)', () => {
    // Source-text proof, since TS excess-property-checking cannot be
    // asserted at runtime in a vitest test: neither function signature
    // below declares `documentType`, so the field is structurally
    // impossible to pass from outside this module.
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/documentDeliveries.ts'), 'utf-8')
    const quoteFnStart = source.indexOf('export async function recordQuoteDeliveryAttempt')
    const quoteFnSignatureEnd = source.indexOf('): Promise<CommercialDocumentDelivery>', quoteFnStart)
    const quoteFnSignature = source.slice(quoteFnStart, quoteFnSignatureEnd)
    expect(quoteFnSignature).not.toContain('documentType')

    const invoiceFnStart = source.indexOf('export async function recordInvoiceDeliveryAttempt')
    const invoiceFnSignatureEnd = source.indexOf('): Promise<CommercialDocumentDelivery>', invoiceFnStart)
    const invoiceFnSignature = source.slice(invoiceFnStart, invoiceFnSignatureEnd)
    expect(invoiceFnSignature).not.toContain('documentType')
  })
})
