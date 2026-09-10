import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C6.5 — real (unmocked) behavioural tests for
// recordPurchaseOrderDeliveryAttempt() (lib/commercial/documentDeliveries.ts)
// and logPurchaseOrderEmailSent() (lib/commercial/auditLog.ts), plus
// static containment on the widening migration. Kept in a SEPARATE file
// from tests/containment/commercialPurchaseOrderDocuments.test.ts, which
// mocks both @/lib/commercial/documentDeliveries and
// @/lib/commercial/auditLog wholesale to isolate the PDF/email ROUTE
// layer — mixing a real-module test into that same file would collide
// with those top-level vi.mock() factories (mirrors the existing
// tests/containment/commercialDocumentDeliveries.test.ts /
// commercialInvoiceSendEmailRoute.test.ts split for the identical
// reason).

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))

beforeEach(() => { sqlMock.mockReset() })

describe('Phase C6.5 — documentDeliveries.ts: recordPurchaseOrderDeliveryAttempt()', () => {
  it('is exported; the raw insert primitive remains unexported', async () => {
    const mod = await import('@/lib/commercial/documentDeliveries')
    expect(typeof mod.recordPurchaseOrderDeliveryAttempt).toBe('function')
    expect((mod as Record<string, unknown>).recordDeliveryAttempt).toBeUndefined()
  })

  it('writes document_type = purchase_order, scoped to the caller organisationId', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'd1', organisation_id: 'org-a', status: 'SENT' }])
    const { recordPurchaseOrderDeliveryAttempt } = await import('@/lib/commercial/documentDeliveries')
    await recordPurchaseOrderDeliveryAttempt({
      organisationId: 'org-a', purchaseOrder: { id: 'po-1', organisation_id: 'org-a' }, channel: 'EMAIL',
      recipient: 'supplier@example.com', status: 'SENT', provider: 'resend', providerMessageId: 'msg-1', createdBy: 'user-1',
    })
    const values = sqlMock.mock.calls[0].slice(1) as unknown[]
    expect(values).toContain('org-a')
    expect(values).toContain('purchase_order')
    expect(values).toContain('SENT')
  })

  it('throws before any SQL when the purchaseOrder object claims a different organisation than the caller — same tenant-integrity discipline as quote/invoice', async () => {
    const { recordPurchaseOrderDeliveryAttempt } = await import('@/lib/commercial/documentDeliveries')
    await expect(recordPurchaseOrderDeliveryAttempt({
      organisationId: 'org-a', purchaseOrder: { id: 'po-1', organisation_id: 'org-b' }, channel: 'EMAIL',
      recipient: 'x@example.com', status: 'SENT', createdBy: 'user-1',
    })).rejects.toThrow(/Tenant mismatch/)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('listDeliveriesForDocument scopes by organisation_id + document_type=purchase_order + document_id together', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { listDeliveriesForDocument } = await import('@/lib/commercial/documentDeliveries')
    await listDeliveriesForDocument({ organisationId: 'org-a', documentType: 'purchase_order', documentId: 'po-1' })
    const values = sqlMock.mock.calls[0].slice(1) as unknown[]
    expect(values).toEqual(['org-a', 'purchase_order', 'po-1'])
  })
})

describe('Phase C6.5 — logPurchaseOrderEmailSent() writes the exact documented action name', () => {
  it('inserts audit_logs with action commercial_purchase_order.email_sent and resource_type commercial_purchase_order (both baked into the query text as literals, matching logInvoiceEmailSent()\'s own identical convention — not interpolated ${} values)', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { logPurchaseOrderEmailSent } = await import('@/lib/commercial/auditLog')
    await logPurchaseOrderEmailSent({ organisationId: 'org-a', userId: 'user-1', purchaseOrderId: 'po-1', result: 'sent', recipientMasked: 's***@example.com', providerMessageId: 'msg-1' })
    const queryText = (sqlMock.mock.calls[0][0] as string[]).join('')
    expect(queryText).toContain('commercial_purchase_order.email_sent')
    expect(queryText).toContain("'commercial_purchase_order'")
    const values = sqlMock.mock.calls[0].slice(1) as unknown[]
    expect(values).toContain('po-1')
  })

  it('never logs the unmasked recipient — only the pre-masked value the caller supplies', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { logPurchaseOrderEmailSent } = await import('@/lib/commercial/auditLog')
    await logPurchaseOrderEmailSent({ organisationId: 'org-a', userId: 'user-1', purchaseOrderId: 'po-1', result: 'sent', recipientMasked: 's***@example.com', providerMessageId: 'msg-1' })
    const insertedJson = JSON.stringify(sqlMock.mock.calls[0])
    expect(insertedJson).not.toContain('supplier@example.com')
  })
})

// ── Migration static containment ────────────────────────────────────

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

describe('Phase C6.5 — the widening migration is additive-only, matching the invoice widening\'s own proven-safe shape', () => {
  const source = stripSqlComments(readSource('scripts/widen-commercial-document-deliveries-for-purchase-orders.sql'))

  it('widens the CHECK to accept exactly quote, invoice, and purchase_order', () => {
    const checkMatch = source.match(/CHECK \(document_type IN \(([^)]+)\)\)/)
    expect(checkMatch).not.toBeNull()
    const values = checkMatch![1].split(',').map(v => v.trim())
    expect(values).toEqual(["'quote'", "'invoice'", "'purchase_order'"])
  })

  it('the ADD CONSTRAINT is guarded by a pg_constraint existence check (idempotent, ADD CONSTRAINT IF NOT EXISTS is not valid PostgreSQL)', () => {
    const doBlocks = source.match(/DO \$\$[\s\S]*?END \$\$;/g) ?? []
    expect(doBlocks.length).toBe(1)
    expect(doBlocks[0]).toMatch(/SELECT 1 FROM pg_constraint WHERE conname = 'commercial_document_deliveries_document_type_check'/)
  })

  it('the DROP CONSTRAINT is guarded by IF EXISTS — safe to replay', () => {
    const dropLines = source.split('\n').filter(l => /DROP CONSTRAINT/i.test(l))
    expect(dropLines.length).toBeGreaterThanOrEqual(1)
    for (const line of dropLines) expect(line, line).toMatch(/DROP CONSTRAINT IF EXISTS/i)
  })

  it('contains no DROP of a TABLE, COLUMN, INDEX, or FOREIGN KEY — only the document_type CHECK is touched (the FK was already dropped by the invoice widening)', () => {
    expect(source).not.toMatch(/DROP\s+TABLE/i)
    expect(source).not.toMatch(/DROP\s+COLUMN/i)
    expect(source).not.toMatch(/DROP\s+INDEX/i)
    expect(source).not.toMatch(/FOREIGN KEY/i)
  })

  it('contains no DELETE, TRUNCATE, UPDATE, or INSERT — schema-only, no data rewrite', () => {
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(source).not.toMatch(/TRUNCATE/i)
    expect(source).not.toMatch(/UPDATE\s+commercial_document_deliveries/i)
    expect(source).not.toMatch(/INSERT INTO/i)
  })

  it('does not touch the C6.2 purchasing migration file — lives in its own dedicated file', () => {
    const purchasingMigration = readSource('scripts/create-commercial-purchasing.sql')
    expect(purchasingMigration).not.toMatch(/commercial_document_deliveries/)
  })
})
