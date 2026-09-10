import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C6.2 — behavioural tests for lib/commercial/purchaseOrders.ts,
// mirroring tests/containment/commercialPaymentsDomain.test.ts's own
// mocking discipline exactly: sibling modules (getSupplier, getProduct,
// getTaxCode) are mocked directly, and '@/lib/db' is mocked at the
// sql-call level, in the exact call order the real code issues them —
// this isolates purchaseOrders.ts's OWN logic (validation, atomic
// statement result handling, error classification) from those modules'
// own separately-tested internals.

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))

const getSupplierMock = vi.fn()
vi.mock('@/lib/commercial/suppliers', () => ({ getSupplier: (...a: unknown[]) => getSupplierMock(...a) }))

const getProductMock = vi.fn()
vi.mock('@/lib/commercial/products', () => ({ getProduct: (...a: unknown[]) => getProductMock(...a) }))

const getTaxCodeMock = vi.fn()
vi.mock('@/lib/commercial/taxCodes', () => ({ getTaxCode: (...a: unknown[]) => getTaxCodeMock(...a) }))

const logPurchaseOrderCreatedMock = vi.fn()
const logPurchaseOrderUpdatedMock = vi.fn()
const logPurchaseOrderSubmittedMock = vi.fn()
const logPurchaseOrderApprovedMock = vi.fn()
const logPurchaseOrderReturnedMock = vi.fn()
const logPurchaseOrderIssuedMock = vi.fn()
const logPurchaseOrderCancelledMock = vi.fn()
vi.mock('@/lib/commercial/auditLog', () => ({
  logPurchaseOrderCreated: (...a: unknown[]) => logPurchaseOrderCreatedMock(...a),
  logPurchaseOrderUpdated: (...a: unknown[]) => logPurchaseOrderUpdatedMock(...a),
  logPurchaseOrderSubmitted: (...a: unknown[]) => logPurchaseOrderSubmittedMock(...a),
  logPurchaseOrderApproved: (...a: unknown[]) => logPurchaseOrderApprovedMock(...a),
  logPurchaseOrderReturned: (...a: unknown[]) => logPurchaseOrderReturnedMock(...a),
  logPurchaseOrderIssued: (...a: unknown[]) => logPurchaseOrderIssuedMock(...a),
  logPurchaseOrderCancelled: (...a: unknown[]) => logPurchaseOrderCancelledMock(...a),
}))

beforeEach(() => {
  sqlMock.mockReset()
  getSupplierMock.mockReset()
  getProductMock.mockReset()
  getTaxCodeMock.mockReset()
  logPurchaseOrderCreatedMock.mockReset()
  logPurchaseOrderUpdatedMock.mockReset()
  logPurchaseOrderSubmittedMock.mockReset()
  logPurchaseOrderApprovedMock.mockReset()
  logPurchaseOrderReturnedMock.mockReset()
  logPurchaseOrderIssuedMock.mockReset()
  logPurchaseOrderCancelledMock.mockReset()
})

const ORG = 'org-a'
const supplier = (overrides: Record<string, unknown> = {}) => ({
  id: 'sup-1', organisation_id: ORG, name: 'Acme Supplies', legal_name: null, contact_name: null,
  email: 'ap@acme.test', phone: null, billing_address: '1 Acme Rd', tax_business_number: '12345',
  supplier_reference: null, payment_terms_days: 14, crm_company_id: null, crm_contact_id: null,
  active: true, notes: null, created_at: '2026-09-10T00:00:00.000Z', updated_at: '2026-09-10T00:00:00.000Z', ...overrides,
})
const poRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'po-1', organisation_id: ORG, supplier_id: 'sup-1', purchase_order_number: null, status: 'DRAFT',
  currency: 'AUD', cost_centre_id: null, supplier_reference: null, delivery_date: null,
  delivery_address_line1: null, delivery_address_line2: null, delivery_suburb: null, delivery_state: null,
  delivery_postcode: null, delivery_country: null, payment_terms_days: null, internal_notes: null, supplier_notes: null,
  subtotal_cents: 0, tax_cents: 0, total_cents: 0,
  supplier_name_snapshot: null, supplier_legal_name_snapshot: null, supplier_contact_name_snapshot: null,
  supplier_email_snapshot: null, supplier_phone_snapshot: null, supplier_address_snapshot: null,
  supplier_tax_business_number_snapshot: null, supplier_reference_snapshot: null, payment_terms_days_snapshot: null,
  return_reason: null, cancel_reason: null, created_by: 'user-1', submitted_by: null, approved_by: null,
  issued_by: null, cancelled_by: null, created_at: '2026-09-10T00:00:00.000Z', updated_at: '2026-09-10T00:00:00.000Z',
  submitted_at: null, approved_at: null, issued_at: null, cancelled_at: null, ...overrides,
})
const poLine = (overrides: Record<string, unknown> = {}) => ({
  id: 'line-1', organisation_id: ORG, purchase_order_id: 'po-1', product_id: null, cost_centre_id: null,
  position: 1, description_snapshot: 'Widget', sku_snapshot: null, unit_snapshot: null, quantity: 2,
  unit_price_cents: 5000, tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00',
  line_subtotal_cents: 10000, line_tax_cents: 1000, line_total_cents: 11000,
  created_at: '2026-09-10T00:00:00.000Z', updated_at: '2026-09-10T00:00:00.000Z', ...overrides,
})

describe('Phase C6.2 — createPurchaseOrder', () => {
  it('rejects a supplier_id that does not resolve for this organisation, without writing anything', async () => {
    getSupplierMock.mockResolvedValueOnce(null)
    const { createPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    await expect(createPurchaseOrder({ organisationId: ORG, userId: 'user-1', supplierId: 'sup-x' }))
      .rejects.toThrow('supplier_id not found for this organisation')
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('creates a DRAFT and logs commercial_purchase_order.created', async () => {
    getSupplierMock.mockResolvedValueOnce(supplier())
    sqlMock.mockResolvedValueOnce([poRow()])
    const { createPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')

    const result = await createPurchaseOrder({ organisationId: ORG, userId: 'user-1', supplierId: 'sup-1' })

    expect(result.status).toBe('DRAFT')
    expect(result.purchase_order_number).toBeNull()
    expect(logPurchaseOrderCreatedMock).toHaveBeenCalledWith({
      organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', after: { supplier_id: 'sup-1', currency: 'AUD' },
    })
  })
})

describe('Phase C6.2 — addPurchaseOrderLine money/tax calculation', () => {
  it('computes an ad-hoc line (no product) with explicit price and tax code', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow({ status: 'DRAFT' })]) // getPurchaseOrder() precheck
      .mockResolvedValueOnce([{ next_position: 1 }])       // MAX(position)+1
      .mockResolvedValueOnce([poLine()])                    // INSERT ... RETURNING
      .mockResolvedValueOnce([poLine()])                    // recalculate: listPurchaseOrderLines
      .mockResolvedValueOnce([])                             // recalculate: UPDATE totals
    getTaxCodeMock.mockResolvedValueOnce({ code: 'GST', rate: '10.00' })

    const { addPurchaseOrderLine } = await import('@/lib/commercial/purchaseOrders')
    const line = await addPurchaseOrderLine({
      organisationId: ORG, purchaseOrderId: 'po-1', description: 'Widget', quantity: 2, unitPriceCents: 5000, taxCodeId: 'tax-1',
    })

    expect(line.line_subtotal_cents).toBe(10000)
    expect(line.line_tax_cents).toBe(1000)
    expect(line.line_total_cents).toBe(11000)
  })

  it('refuses to add a line to a non-DRAFT purchase order', async () => {
    sqlMock.mockResolvedValueOnce([poRow({ status: 'ISSUED' })])
    const { addPurchaseOrderLine } = await import('@/lib/commercial/purchaseOrders')
    await expect(addPurchaseOrderLine({ organisationId: ORG, purchaseOrderId: 'po-1', description: 'Widget', quantity: 1, unitPriceCents: 100 }))
      .rejects.toThrow('Purchase order is ISSUED and can no longer be edited')
  })

  it('populates description/sku/unit/price/tax from the product when product_id is given and no override is supplied', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow({ status: 'DRAFT' })])
      .mockResolvedValueOnce([{ next_position: 1 }])
      .mockResolvedValueOnce([poLine({ description_snapshot: 'Product Name', sku_snapshot: 'SKU-1' })])
      .mockResolvedValueOnce([poLine()])
      .mockResolvedValueOnce([])
    getProductMock.mockResolvedValueOnce({ name: 'Product Name', sku: 'SKU-1', unit_label: 'each', default_unit_price_cents: 5000, default_tax_code_id: 'tax-1' })
    getTaxCodeMock.mockResolvedValueOnce({ code: 'GST', rate: '10.00' })

    const { addPurchaseOrderLine } = await import('@/lib/commercial/purchaseOrders')
    const line = await addPurchaseOrderLine({ organisationId: ORG, purchaseOrderId: 'po-1', productId: 'prod-1', quantity: 2 })

    expect(line.description_snapshot).toBe('Product Name')
    expect(getProductMock).toHaveBeenCalledWith(ORG, 'prod-1')
  })
})

describe('Phase C6.2 — submitPurchaseOrder', () => {
  it('refuses to submit a purchase order with no lines', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow({ status: 'DRAFT' })]) // getPurchaseOrder
      .mockResolvedValueOnce([])                             // listPurchaseOrderLines -> empty
    const { submitPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    await expect(submitPurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1' }))
      .rejects.toThrow('cannot submit a purchase order with no lines')
  })

  it('transitions DRAFT -> PENDING_APPROVAL and logs the event', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow({ status: 'DRAFT' })])
      .mockResolvedValueOnce([poLine()])
      .mockResolvedValueOnce([poRow({ status: 'PENDING_APPROVAL' })])
    const { submitPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    const result = await submitPurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1' })
    expect(result.status).toBe('PENDING_APPROVAL')
    expect(logPurchaseOrderSubmittedMock).toHaveBeenCalledWith({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1' })
  })

  it('throws a concurrency-aborted error if the guarded UPDATE affects zero rows', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow({ status: 'DRAFT' })])
      .mockResolvedValueOnce([poLine()])
      .mockResolvedValueOnce([]) // guarded UPDATE matched nothing
    const { submitPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    await expect(submitPurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1' }))
      .rejects.toThrow('purchase order status changed concurrently; submit aborted')
  })
})

describe('Phase C6.2 — approvePurchaseOrder', () => {
  it('cannot approve a DRAFT purchase order directly (lifecycle guard fires before any UPDATE)', async () => {
    sqlMock.mockResolvedValueOnce([poRow({ status: 'DRAFT' })])
    const { approvePurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    await expect(approvePurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1' }))
      .rejects.toThrow('Cannot transition purchase order from DRAFT to APPROVED')
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('cannot approve twice — the second call throws once the row is already APPROVED', async () => {
    sqlMock.mockResolvedValueOnce([poRow({ status: 'APPROVED' })])
    const { approvePurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    await expect(approvePurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1' }))
      .rejects.toThrow('Cannot transition purchase order from APPROVED to APPROVED')
  })

  it('transitions PENDING_APPROVAL -> APPROVED and logs the event', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow({ status: 'PENDING_APPROVAL' })])
      .mockResolvedValueOnce([poRow({ status: 'APPROVED' })])
    const { approvePurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    const result = await approvePurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1' })
    expect(result.status).toBe('APPROVED')
    expect(logPurchaseOrderApprovedMock).toHaveBeenCalledWith({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1' })
  })
})

describe('Phase C6.2 — returnPurchaseOrderToDraft', () => {
  it('requires a non-empty reason without ever calling sql', async () => {
    const { returnPurchaseOrderToDraft } = await import('@/lib/commercial/purchaseOrders')
    await expect(returnPurchaseOrderToDraft({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', reason: '   ' }))
      .rejects.toThrow('return reason is required')
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('transitions PENDING_APPROVAL -> DRAFT with the trimmed reason and logs the event', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow({ status: 'PENDING_APPROVAL' })])
      .mockResolvedValueOnce([poRow({ status: 'DRAFT', return_reason: 'Wrong supplier' })])
    const { returnPurchaseOrderToDraft } = await import('@/lib/commercial/purchaseOrders')
    const result = await returnPurchaseOrderToDraft({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', reason: '  Wrong supplier  ' })
    expect(result.status).toBe('DRAFT')
    expect(logPurchaseOrderReturnedMock).toHaveBeenCalledWith({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', returnReason: 'Wrong supplier' })
  })
})

describe('Phase C6.2 — issuePurchaseOrder', () => {
  it('refuses to issue a purchase order with no lines', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow({ status: 'APPROVED' })])
      .mockResolvedValueOnce([])
    const { issuePurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    await expect(issuePurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1' }))
      .rejects.toThrow('cannot issue a purchase order with no lines')
  })

  it('allocates PO-000001 atomically and snapshots the supplier on success', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow({ status: 'APPROVED' })]) // getPurchaseOrder (bundle)
      .mockResolvedValueOnce([poLine()])                        // listPurchaseOrderLines (bundle)
      .mockResolvedValueOnce([poLine()])                        // recalculate: list
      .mockResolvedValueOnce([])                                 // recalculate: update totals
      .mockResolvedValueOnce([])                                 // sequence bootstrap INSERT..ON CONFLICT
      .mockResolvedValueOnce([poRow({                           // the atomic WITH guard/seq UPDATE
        status: 'ISSUED', purchase_order_number: 'PO-000001', total_cents: 11000,
        supplier_name_snapshot: 'Acme Supplies',
      })])
    getSupplierMock.mockResolvedValueOnce(supplier())

    const { issuePurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    const result = await issuePurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1' })

    expect(result.status).toBe('ISSUED')
    expect(result.purchase_order_number).toBe('PO-000001')
    expect(logPurchaseOrderIssuedMock).toHaveBeenCalledWith({
      organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', purchaseOrderNumber: 'PO-000001', totalCents: 11000,
    })
  })

  it('throws "no number consumed" when the atomic guard finds the PO no longer APPROVED', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow({ status: 'APPROVED' })])
      .mockResolvedValueOnce([poLine()])
      .mockResolvedValueOnce([poLine()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // sequence bootstrap
      .mockResolvedValueOnce([]) // atomic UPDATE returns zero rows — lost the race
    getSupplierMock.mockResolvedValueOnce(supplier())

    const { issuePurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    await expect(issuePurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1' }))
      .rejects.toThrow('purchase order status changed concurrently; issue aborted (the atomic guard prevented any number from being consumed)')
  })
})

describe('Phase C6.2 — cancelPurchaseOrder', () => {
  it('requires a non-empty reason without ever calling sql', async () => {
    const { cancelPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    await expect(cancelPurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', reason: '' }))
      .rejects.toThrow('cancel_reason is required')
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('cannot cancel a DRAFT purchase order — only ISSUED may be cancelled in C6.2', async () => {
    sqlMock.mockResolvedValueOnce([poRow({ status: 'DRAFT' })])
    const { cancelPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    await expect(cancelPurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', reason: 'no longer needed' }))
      .rejects.toThrow('Cannot transition purchase order from DRAFT to CANCELLED')
  })

  it('transitions ISSUED -> CANCELLED, preserves the number, and logs the event', async () => {
    sqlMock
      .mockResolvedValueOnce([poRow({ status: 'ISSUED', purchase_order_number: 'PO-000001' })])
      .mockResolvedValueOnce([poRow({ status: 'CANCELLED', purchase_order_number: 'PO-000001', cancel_reason: 'Duplicate order' })])
    const { cancelPurchaseOrder } = await import('@/lib/commercial/purchaseOrders')
    const result = await cancelPurchaseOrder({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', reason: '  Duplicate order  ' })
    expect(result.status).toBe('CANCELLED')
    expect(result.purchase_order_number).toBe('PO-000001')
    expect(logPurchaseOrderCancelledMock).toHaveBeenCalledWith({ organisationId: ORG, userId: 'user-1', purchaseOrderId: 'po-1', cancelReason: 'Duplicate order' })
  })
})
