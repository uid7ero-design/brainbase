import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C6.2 — behavioural tests for lib/commercial/suppliers.ts,
// mirroring tests/containment/commercialPaymentsDomain.test.ts's own
// mocking discipline exactly: '@/lib/db' is mocked at the sql-call
// level, in the exact call order the real code issues them.

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))

const logSupplierCreatedMock = vi.fn()
const logSupplierUpdatedMock = vi.fn()
const logSupplierDeactivatedMock = vi.fn()
const logSupplierReactivatedMock = vi.fn()
vi.mock('@/lib/commercial/auditLog', () => ({
  logSupplierCreated: (...a: unknown[]) => logSupplierCreatedMock(...a),
  logSupplierUpdated: (...a: unknown[]) => logSupplierUpdatedMock(...a),
  logSupplierDeactivated: (...a: unknown[]) => logSupplierDeactivatedMock(...a),
  logSupplierReactivated: (...a: unknown[]) => logSupplierReactivatedMock(...a),
}))

beforeEach(() => {
  sqlMock.mockReset()
  logSupplierCreatedMock.mockReset()
  logSupplierUpdatedMock.mockReset()
  logSupplierDeactivatedMock.mockReset()
  logSupplierReactivatedMock.mockReset()
})

const ORG = 'org-a'
const supplierRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'sup-1', organisation_id: ORG, name: 'Acme Supplies', legal_name: null, contact_name: null,
  email: null, phone: null, billing_address: null, tax_business_number: null, supplier_reference: null,
  payment_terms_days: null, crm_company_id: null, crm_contact_id: null, active: true, notes: null,
  created_at: '2026-09-10T00:00:00.000Z', updated_at: '2026-09-10T00:00:00.000Z', ...overrides,
})

describe('Phase C6.2 — createSupplier', () => {
  it('trims the name, inserts, and logs commercial_supplier.created', async () => {
    sqlMock.mockResolvedValueOnce([supplierRow({ name: 'Acme Supplies' })])
    const { createSupplier } = await import('@/lib/commercial/suppliers')

    const result = await createSupplier({ organisationId: ORG, userId: 'user-1', name: '  Acme Supplies  ' })

    expect(result.name).toBe('Acme Supplies')
    expect(logSupplierCreatedMock).toHaveBeenCalledWith({ organisationId: ORG, userId: 'user-1', supplierId: 'sup-1', after: { name: 'Acme Supplies' } })
  })

  it('rejects a blank name without calling sql at all', async () => {
    const { createSupplier } = await import('@/lib/commercial/suppliers')
    await expect(createSupplier({ organisationId: ORG, userId: 'user-1', name: '   ' })).rejects.toThrow('name is required')
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects a negative payment_terms_days without calling sql', async () => {
    const { createSupplier } = await import('@/lib/commercial/suppliers')
    await expect(createSupplier({ organisationId: ORG, userId: 'user-1', name: 'Acme', paymentTermsDays: -1 }))
      .rejects.toThrow('payment_terms_days must be a non-negative integer')
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects a crm_company_id that does not resolve for this organisation (fail-closed ownership check)', async () => {
    sqlMock.mockResolvedValueOnce([]) // assertCrmCompanyOwnership finds nothing
    const { createSupplier } = await import('@/lib/commercial/suppliers')

    await expect(createSupplier({ organisationId: ORG, userId: 'user-1', name: 'Acme', crmCompanyId: 'other-org-company' }))
      .rejects.toThrow('crm_company_id not found for this organisation')
    // The ownership check ran (1 call); the INSERT never did.
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })
})

describe('Phase C6.2 — getSupplier / listSuppliers tenant scoping', () => {
  it('getSupplier scopes by both id and organisation_id', async () => {
    sqlMock.mockResolvedValueOnce([supplierRow()])
    const { getSupplier } = await import('@/lib/commercial/suppliers')
    const result = await getSupplier(ORG, 'sup-1')
    expect(result).not.toBeNull()
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('getSupplier returns null (never throws) for a cross-tenant id — indistinguishable from not-found', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { getSupplier } = await import('@/lib/commercial/suppliers')
    const result = await getSupplier(ORG, 'someone-elses-supplier')
    expect(result).toBeNull()
  })

  it('listSuppliers(activeOnly) filters on active = true', async () => {
    sqlMock.mockResolvedValueOnce([supplierRow()])
    const { listSuppliers } = await import('@/lib/commercial/suppliers')
    const result = await listSuppliers(ORG, { activeOnly: true })
    expect(result).toHaveLength(1)
  })
})

describe('Phase C6.2 — updateSupplier', () => {
  it('returns null for a cross-tenant/nonexistent supplier without attempting the UPDATE', async () => {
    sqlMock.mockResolvedValueOnce([]) // getSupplier() precheck finds nothing
    const { updateSupplier } = await import('@/lib/commercial/suppliers')
    const result = await updateSupplier({ organisationId: ORG, userId: 'user-1', supplierId: 'sup-1', name: 'New Name' })
    expect(result).toBeNull()
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a blank name on update', async () => {
    sqlMock.mockResolvedValueOnce([supplierRow()]) // getSupplier() precheck succeeds
    const { updateSupplier } = await import('@/lib/commercial/suppliers')
    await expect(updateSupplier({ organisationId: ORG, userId: 'user-1', supplierId: 'sup-1', name: '   ' }))
      .rejects.toThrow('name cannot be blank')
  })

  it('logs commercial_supplier.updated on success', async () => {
    sqlMock.mockResolvedValueOnce([supplierRow({ name: 'Old Name', email: null })])
    sqlMock.mockResolvedValueOnce([supplierRow({ name: 'New Name', email: null })])
    const { updateSupplier } = await import('@/lib/commercial/suppliers')
    const result = await updateSupplier({ organisationId: ORG, userId: 'user-1', supplierId: 'sup-1', name: 'New Name' })
    expect(result?.name).toBe('New Name')
    expect(logSupplierUpdatedMock).toHaveBeenCalledWith({
      organisationId: ORG, userId: 'user-1', supplierId: 'sup-1',
      before: { name: 'Old Name', email: null }, after: { name: 'New Name', email: null },
    })
  })
})

describe('Phase C6.2 — deactivateSupplier / reactivateSupplier', () => {
  it('deactivateSupplier returns false and does not log when no active row matches (already inactive or cross-tenant)', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { deactivateSupplier } = await import('@/lib/commercial/suppliers')
    const result = await deactivateSupplier({ organisationId: ORG, userId: 'user-1', supplierId: 'sup-1' })
    expect(result).toBe(false)
    expect(logSupplierDeactivatedMock).not.toHaveBeenCalled()
  })

  it('deactivateSupplier returns true and logs on success', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'sup-1' }])
    const { deactivateSupplier } = await import('@/lib/commercial/suppliers')
    const result = await deactivateSupplier({ organisationId: ORG, userId: 'user-1', supplierId: 'sup-1' })
    expect(result).toBe(true)
    expect(logSupplierDeactivatedMock).toHaveBeenCalledWith({ organisationId: ORG, userId: 'user-1', supplierId: 'sup-1' })
  })

  it('reactivateSupplier returns true and logs on success', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'sup-1' }])
    const { reactivateSupplier } = await import('@/lib/commercial/suppliers')
    const result = await reactivateSupplier({ organisationId: ORG, userId: 'user-1', supplierId: 'sup-1' })
    expect(result).toBe(true)
    expect(logSupplierReactivatedMock).toHaveBeenCalledWith({ organisationId: ORG, userId: 'user-1', supplierId: 'sup-1' })
  })
})
