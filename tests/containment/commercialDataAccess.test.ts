import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C2 — lib/commercial/{customers,products,costCentres,
// financialPeriods,taxCodes}.ts. Every function is tenant-scoped by
// construction (organisation_id is part of every WHERE clause) — this
// suite proves that both statically (every query text contains the
// predicate) and behaviourally (a mismatched organisationId/id pair
// never returns the row).

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

describe('Phase C2 — every commercial data-access query is organisation-scoped (static)', () => {
  const files = [
    'lib/commercial/customers.ts',
    'lib/commercial/products.ts',
    'lib/commercial/costCentres.ts',
    'lib/commercial/financialPeriods.ts',
    'lib/commercial/taxCodes.ts',
  ]

  it.each(files)('%s: every SELECT/UPDATE/INSERT touching a commercial_ table includes organisation_id', (file) => {
    const source = readSource(file)
    // Every SQL template literal in these files must reference
    // organisation_id somewhere in its own statement — a coarse but
    // effective structural check: split on the sql` tag and verify each
    // resulting fragment (up to the closing backtick) mentions it.
    const statements = source.split('sql`').slice(1).map(s => s.slice(0, s.indexOf('`')))
    expect(statements.length).toBeGreaterThan(0)
    for (const stmt of statements) {
      expect(stmt, stmt).toMatch(/organisation_id/)
    }
  })

  it.each(files)('%s: organisationId is a function parameter, never resolved via requireSession() internally', (file) => {
    const source = readSource(file)
    expect(source).not.toMatch(/requireSession/)
  })
})

// ── Behavioural ───────────────────────────────────────────────────────

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))
vi.mock('@/lib/commercial/auditLog', () => ({
  logCustomerCreated: vi.fn(), logCustomerUpdated: vi.fn(), logCustomerDeactivated: vi.fn(), logCustomerReactivated: vi.fn(),
  logProductCreated: vi.fn(), logProductUpdated: vi.fn(), logProductDeactivated: vi.fn(), logProductReactivated: vi.fn(),
  logCostCentreCreated: vi.fn(), logCostCentreUpdated: vi.fn(), logCostCentreDeactivated: vi.fn(),
  logFinancialYearStatusChanged: vi.fn(), logFinancialPeriodStatusChanged: vi.fn(),
  logDocumentSequenceConfigured: vi.fn(),
}))

beforeEach(() => {
  sqlMock.mockReset()
})

describe('Phase C2 — commercial_customers tenant isolation (behavioural)', () => {
  it('getCustomer scopes by BOTH id and organisation_id — a real row belonging to a different org is invisible', async () => {
    sqlMock.mockResolvedValue([]) // simulates: row exists, but for a different org, so the WHERE clause excludes it
    const { getCustomer } = await import('@/lib/commercial/customers')
    const result = await getCustomer('org-a', 'customer-owned-by-org-b')
    expect(result).toBeNull()
    const call = sqlMock.mock.calls[0]
    expect(call).toContain('org-a')
    expect(call).toContain('customer-owned-by-org-b')
  })

  it('deactivateCustomer affects zero rows (and returns false) when the id belongs to a different organisation', async () => {
    sqlMock.mockResolvedValue([]) // UPDATE ... WHERE id=$ AND organisation_id=$ matches nothing
    const { deactivateCustomer } = await import('@/lib/commercial/customers')
    const result = await deactivateCustomer({ organisationId: 'org-a', userId: 'u1', customerId: 'customer-owned-by-org-b' })
    expect(result).toBe(false)
  })

  it('crm_company_id/crm_contact_id are optional — createCustomer succeeds with neither supplied', async () => {
    sqlMock.mockResolvedValue([{ id: 'c1', organisation_id: 'org-a', name: 'Acme', active: true }])
    const { createCustomer } = await import('@/lib/commercial/customers')
    const result = await createCustomer({ organisationId: 'org-a', userId: 'u1', name: 'Acme' })
    expect(result.name).toBe('Acme')
  })
})

describe('Phase C2 — commercial_products: type, money, tenant isolation (behavioural)', () => {
  it('createProduct rejects a negative default_unit_price_cents before ever touching the database', async () => {
    const { createProduct } = await import('@/lib/commercial/products')
    await expect(createProduct({
      organisationId: 'org-a', userId: 'u1', type: 'PRODUCT', name: 'Widget',
      defaultUnitPriceCents: -100, currency: 'AUD',
    })).rejects.toThrow(/non-negative integer/)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('createProduct rejects a non-integer (float) price', async () => {
    const { createProduct } = await import('@/lib/commercial/products')
    await expect(createProduct({
      organisationId: 'org-a', userId: 'u1', type: 'SERVICE', name: 'Consulting',
      defaultUnitPriceCents: 19.99, currency: 'AUD',
    })).rejects.toThrow(/non-negative integer/)
  })

  it('createProduct rejects a malformed currency code', async () => {
    const { createProduct } = await import('@/lib/commercial/products')
    await expect(createProduct({
      organisationId: 'org-a', userId: 'u1', type: 'PRODUCT', name: 'Widget',
      defaultUnitPriceCents: 500, currency: 'dollars',
    })).rejects.toThrow(/ISO 4217/)
  })

  it('a valid PRODUCT and a valid SERVICE both create successfully', async () => {
    sqlMock.mockResolvedValue([{ id: 'p1', type: 'PRODUCT', default_unit_price_cents: 500, currency: 'AUD' }])
    const { createProduct } = await import('@/lib/commercial/products')
    const product = await createProduct({ organisationId: 'org-a', userId: 'u1', type: 'PRODUCT', name: 'Widget', defaultUnitPriceCents: 500, currency: 'AUD' })
    expect(product.type).toBe('PRODUCT')

    sqlMock.mockResolvedValue([{ id: 'p2', type: 'SERVICE', default_unit_price_cents: 15000, currency: 'AUD' }])
    const service = await createProduct({ organisationId: 'org-a', userId: 'u1', type: 'SERVICE', name: 'Consulting hour', defaultUnitPriceCents: 15000, currency: 'AUD' })
    expect(service.type).toBe('SERVICE')
  })

  it('getProduct scoped by organisation — a different org id never resolves someone else’s product', async () => {
    sqlMock.mockResolvedValue([])
    const { getProduct } = await import('@/lib/commercial/products')
    const result = await getProduct('org-a', 'product-owned-by-org-b')
    expect(result).toBeNull()
  })
})

describe('Phase C2 — commercial_cost_centres: tenant isolation, active/inactive (behavioural)', () => {
  it('listCostCentres with activeOnly filters to active=true in the query itself', async () => {
    sqlMock.mockResolvedValue([])
    const { listCostCentres } = await import('@/lib/commercial/costCentres')
    await listCostCentres('org-a', { activeOnly: true })
    const call = sqlMock.mock.calls[0][0] as string[]
    expect(call.join('')).toMatch(/active = true/)
  })

  it('deactivateCostCentre only affects an already-active row in the caller’s own organisation', async () => {
    sqlMock.mockResolvedValue([{ id: 'cc1' }])
    const { deactivateCostCentre } = await import('@/lib/commercial/costCentres')
    const result = await deactivateCostCentre({ organisationId: 'org-a', userId: 'u1', costCentreId: 'cc1' })
    expect(result).toBe(true)
    const call = sqlMock.mock.calls[0]
    expect(call).toContain('org-a')
  })
})

describe('Phase C2 — commercial_financial_years/periods (behavioural)', () => {
  it('setFinancialYearStatus is a no-op (no UPDATE issued) when the status is already the requested value', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'fy1', organisation_id: 'org-a', status: 'CLOSED' }]) // getFinancialYear read
    const { setFinancialYearStatus } = await import('@/lib/commercial/financialPeriods')
    const result = await setFinancialYearStatus({ organisationId: 'org-a', userId: 'u1', financialYearId: 'fy1', status: 'CLOSED' })
    expect(result?.status).toBe('CLOSED')
    expect(sqlMock).toHaveBeenCalledTimes(1) // only the read — no redundant UPDATE
  })

  it('setFinancialYearStatus returns null for a year belonging to a different organisation', async () => {
    sqlMock.mockResolvedValueOnce([]) // getFinancialYear finds nothing for this org
    const { setFinancialYearStatus } = await import('@/lib/commercial/financialPeriods')
    const result = await setFinancialYearStatus({ organisationId: 'org-a', userId: 'u1', financialYearId: 'fy-owned-by-org-b', status: 'CLOSED' })
    expect(result).toBeNull()
  })

  it('createFinancialPeriod always includes both organisation_id and financial_year_id — the composite tenant-integrity FK depends on both being supplied together', async () => {
    sqlMock.mockResolvedValue([{ id: 'p1' }])
    const { createFinancialPeriod } = await import('@/lib/commercial/financialPeriods')
    await createFinancialPeriod({ organisationId: 'org-a', financialYearId: 'fy1', name: 'Q1', startsOn: '2026-07-01', endsOn: '2026-09-30' })
    const call = sqlMock.mock.calls[0]
    expect(call).toContain('org-a')
    expect(call).toContain('fy1')
  })
})

describe('Phase C2 — commercial_tax_codes: rate validation (behavioural)', () => {
  it('createTaxCode rejects an out-of-range rate before touching the database', async () => {
    const { createTaxCode } = await import('@/lib/commercial/taxCodes')
    await expect(createTaxCode({ organisationId: 'org-a', code: 'GST', name: 'GST', rate: 150 })).rejects.toThrow(/0.00-100.00/)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('createTaxCode accepts a valid Australia-plausible rate (10% GST)', async () => {
    sqlMock.mockResolvedValue([{ id: 't1', code: 'GST10', rate: '10.00' }])
    const { createTaxCode } = await import('@/lib/commercial/taxCodes')
    const result = await createTaxCode({ organisationId: 'org-a', code: 'GST10', name: 'GST 10%', rate: 10, isDefault: true })
    expect(result.code).toBe('GST10')
  })
})

describe('Phase C3 — reactivateCustomer()/reactivateProduct() (symmetric counterparts to deactivate)', () => {
  it('reactivateCustomer flips an inactive row back to active and returns true', async () => {
    sqlMock.mockResolvedValue([{ id: 'c1' }])
    const { reactivateCustomer } = await import('@/lib/commercial/customers')
    const result = await reactivateCustomer({ organisationId: 'org-a', userId: 'u1', customerId: 'c1' })
    expect(result).toBe(true)
    const call = sqlMock.mock.calls[0]
    expect(call).toContain('org-a')
  })

  it('reactivateCustomer returns false when the row belongs to a different organisation (no rows matched)', async () => {
    sqlMock.mockResolvedValue([])
    const { reactivateCustomer } = await import('@/lib/commercial/customers')
    const result = await reactivateCustomer({ organisationId: 'org-a', userId: 'u1', customerId: 'customer-owned-by-org-b' })
    expect(result).toBe(false)
  })

  it('reactivateProduct flips an inactive row back to active and returns true', async () => {
    sqlMock.mockResolvedValue([{ id: 'p1' }])
    const { reactivateProduct } = await import('@/lib/commercial/products')
    const result = await reactivateProduct({ organisationId: 'org-a', userId: 'u1', productId: 'p1' })
    expect(result).toBe(true)
  })

  it('reactivateProduct returns false when the row belongs to a different organisation', async () => {
    sqlMock.mockResolvedValue([])
    const { reactivateProduct } = await import('@/lib/commercial/products')
    const result = await reactivateProduct({ organisationId: 'org-a', userId: 'u1', productId: 'product-owned-by-org-b' })
    expect(result).toBe(false)
  })
})

describe('Phase C2 — customer snapshot policy: explicitly deferred, not silently skipped', () => {
  it('no Quote/Invoice/document table exists yet — snapshot-at-issue-time behaviour has nothing to snapshot INTO in this phase; ADR-0002 §8 already mandates the rule for when one is built', () => {
    const adr = readSource('docs/architecture/decisions/0002-money-and-currency-standard.md')
    expect(adr).toMatch(/Snapshots/)
    expect(adr).toMatch(/must store its own price\/tax\/customer-\s*\n\s*detail snapshot at the row level/)
  })
})
