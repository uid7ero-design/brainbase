import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C2-TIR — remediates the two tenant-isolation blockers
// empirically confirmed in Phase C2-PMC:
//   1. commercial_customers.crm_company_id / crm_contact_id could
//      reference a CRM record belonging to a different organisation
//      (fixed: fail-closed application-level ownership validation,
//      since crm_companies/crm_contacts have no composite tenant key
//      and this phase does not alter that separate, already-shipped
//      vertical's schema).
//   2. commercial_products.default_tax_code_id could reference a
//      commercial_tax_codes row belonging to a different organisation
//      (fixed: structural composite FK, the same pattern already proven
//      for commercial_financial_periods -> commercial_financial_years —
//      commercial_tax_codes is owned by this phase, so extending its
//      schema carries none of the cross-team risk the CRM tables would).

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

describe('Phase C2-TIR — schema: composite FK for product tax codes', () => {
  const source = stripComments(readSource('scripts/create-commercial-core.sql'))

  it('commercial_tax_codes carries UNIQUE(id, organisation_id), the composite tenant-integrity anchor', () => {
    const start = source.indexOf('CREATE TABLE IF NOT EXISTS commercial_tax_codes (')
    const body = source.slice(start, source.indexOf(');', start))
    expect(body).toMatch(/UNIQUE \(id, organisation_id\)/)
  })

  it('commercial_products.default_tax_code_id is a composite FK onto commercial_tax_codes(id, organisation_id)', () => {
    const start = source.indexOf('CREATE TABLE IF NOT EXISTS commercial_products (')
    const body = source.slice(start, source.indexOf(');', start))
    expect(body).toMatch(/FOREIGN KEY \(default_tax_code_id, organisation_id\)/)
    expect(body).toMatch(/REFERENCES commercial_tax_codes \(id, organisation_id\)/)
  })

  it('the migration remains idempotent (still every statement uses IF NOT EXISTS) after this change', () => {
    const ddlLines = source.split('\n').filter(l => /CREATE (TABLE|INDEX|UNIQUE INDEX)/.test(l))
    for (const line of ddlLines) expect(line, line).toMatch(/IF NOT EXISTS/)
  })

  it('no destructive DDL was introduced by this remediation', () => {
    expect(source).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i)
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(source).not.toMatch(/TRUNCATE/i)
  })
})

// ── Behavioural: lib/commercial/customers.ts CRM-link ownership ────────

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))
vi.mock('@/lib/commercial/auditLog', () => ({
  logCustomerCreated: vi.fn(), logCustomerUpdated: vi.fn(), logCustomerDeactivated: vi.fn(),
}))

beforeEach(() => { sqlMock.mockReset() })

describe('Phase C2-TIR — createCustomer() CRM-link ownership (behavioural)', () => {
  it('same-org crm_company_id: ownership check passes, INSERT proceeds', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'company-1' }]) // ownership check finds the row for this org
      .mockResolvedValueOnce([{ id: 'cust-1', name: 'Acme', crm_company_id: 'company-1' }]); // INSERT RETURNING
    const { createCustomer } = await import('@/lib/commercial/customers')
    const customer = await createCustomer({ organisationId: 'org-a', userId: 'u1', name: 'Acme', crmCompanyId: 'company-1' })
    expect(customer.id).toBe('cust-1')
    expect(sqlMock).toHaveBeenCalledTimes(2)
  })

  it('cross-org crm_company_id: ownership check finds nothing, INSERT never runs, throws', async () => {
    sqlMock.mockResolvedValueOnce([]) // ownership check finds no matching row for THIS org
    const { createCustomer } = await import('@/lib/commercial/customers')
    await expect(createCustomer({ organisationId: 'org-a', userId: 'u1', name: 'Acme', crmCompanyId: 'company-owned-by-org-b' }))
      .rejects.toThrow(/crm_company_id not found/)
    expect(sqlMock).toHaveBeenCalledTimes(1) // only the ownership check — no INSERT attempted
  })

  it('missing/nonexistent crm_company_id: same rejection as cross-org (indistinguishable, no enumeration leak)', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { createCustomer } = await import('@/lib/commercial/customers')
    await expect(createCustomer({ organisationId: 'org-a', userId: 'u1', name: 'Acme', crmCompanyId: 'totally-fake-id' }))
      .rejects.toThrow(/crm_company_id not found/)
  })

  it('null crm_company_id: no ownership check performed, INSERT proceeds directly', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'cust-2', name: 'Acme', crm_company_id: null }])
    const { createCustomer } = await import('@/lib/commercial/customers')
    const customer = await createCustomer({ organisationId: 'org-a', userId: 'u1', name: 'Acme', crmCompanyId: null })
    expect(customer.id).toBe('cust-2')
    expect(sqlMock).toHaveBeenCalledTimes(1) // only the INSERT — no ownership check for a null link
  })

  it('undefined crm_company_id (field simply omitted): same as null — no ownership check, INSERT proceeds', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'cust-3', name: 'Acme' }])
    const { createCustomer } = await import('@/lib/commercial/customers')
    await createCustomer({ organisationId: 'org-a', userId: 'u1', name: 'Acme' })
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('same-org crm_contact_id: ownership check passes, INSERT proceeds', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'contact-1' }])
      .mockResolvedValueOnce([{ id: 'cust-4', name: 'Beta', crm_contact_id: 'contact-1' }]);
    const { createCustomer } = await import('@/lib/commercial/customers')
    const customer = await createCustomer({ organisationId: 'org-a', userId: 'u1', name: 'Beta', crmContactId: 'contact-1' })
    expect(customer.id).toBe('cust-4')
  })

  it('cross-org crm_contact_id: rejected, no INSERT attempted', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { createCustomer } = await import('@/lib/commercial/customers')
    await expect(createCustomer({ organisationId: 'org-a', userId: 'u1', name: 'Beta', crmContactId: 'contact-owned-by-org-b' }))
      .rejects.toThrow(/crm_contact_id not found/)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('null crm_contact_id: no ownership check, INSERT proceeds', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'cust-5', name: 'Beta', crm_contact_id: null }])
    const { createCustomer } = await import('@/lib/commercial/customers')
    await createCustomer({ organisationId: 'org-a', userId: 'u1', name: 'Beta', crmContactId: null })
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('BOTH crm_company_id and crm_contact_id supplied: both are checked before any INSERT', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'company-1' }]) // company ownership check
      .mockResolvedValueOnce([{ id: 'contact-1' }]) // contact ownership check
      .mockResolvedValueOnce([{ id: 'cust-6' }]);    // INSERT
    const { createCustomer } = await import('@/lib/commercial/customers')
    await createCustomer({ organisationId: 'org-a', userId: 'u1', name: 'Gamma', crmCompanyId: 'company-1', crmContactId: 'contact-1' })
    expect(sqlMock).toHaveBeenCalledTimes(3)
  })
})

describe('Phase C2-TIR — updateCustomer() enforces the identical CRM-link ownership rule', () => {
  it('cross-org crm_company_id on update is rejected before the UPDATE statement runs', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'cust-1', organisation_id: 'org-a', name: 'Acme' }]) // getCustomer (before)
      .mockResolvedValueOnce([]); // ownership check fails
    const { updateCustomer } = await import('@/lib/commercial/customers')
    await expect(updateCustomer({ organisationId: 'org-a', userId: 'u1', customerId: 'cust-1', crmCompanyId: 'company-owned-by-org-b' }))
      .rejects.toThrow(/crm_company_id not found/)
    expect(sqlMock).toHaveBeenCalledTimes(2) // getCustomer + ownership check — no UPDATE attempted
  })

  it('cross-org crm_contact_id on update is rejected the same way', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'cust-1', organisation_id: 'org-a', name: 'Acme' }])
      .mockResolvedValueOnce([]);
    const { updateCustomer } = await import('@/lib/commercial/customers')
    await expect(updateCustomer({ organisationId: 'org-a', userId: 'u1', customerId: 'cust-1', crmContactId: 'contact-owned-by-org-b' }))
      .rejects.toThrow(/crm_contact_id not found/)
  })

  it('same-org crm_company_id on update succeeds', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'cust-1', organisation_id: 'org-a', name: 'Acme', billing_email: null }]) // before
      .mockResolvedValueOnce([{ id: 'company-1' }]) // ownership ok
      .mockResolvedValueOnce([{ id: 'cust-1', name: 'Acme', billing_email: null, crm_company_id: 'company-1' }]); // UPDATE RETURNING
    const { updateCustomer } = await import('@/lib/commercial/customers')
    const result = await updateCustomer({ organisationId: 'org-a', userId: 'u1', customerId: 'cust-1', crmCompanyId: 'company-1' })
    expect(result?.crm_company_id).toBe('company-1')
  })

  it('omitting crm_company_id/crm_contact_id entirely on update never triggers an ownership check', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'cust-1', organisation_id: 'org-a', name: 'Acme', billing_email: null }])
      .mockResolvedValueOnce([{ id: 'cust-1', name: 'Acme Updated', billing_email: null }]);
    const { updateCustomer } = await import('@/lib/commercial/customers')
    await updateCustomer({ organisationId: 'org-a', userId: 'u1', customerId: 'cust-1', name: 'Acme Updated' })
    expect(sqlMock).toHaveBeenCalledTimes(2) // getCustomer + UPDATE only
  })
})

describe('Phase C2-TIR — error messages never distinguish "not found" from "not yours"', () => {
  it('the two ownership-check functions throw identically-shaped errors for both cases (no enumeration leak)', () => {
    const source = readSource('lib/commercial/customers.ts')
    // Both branches (assertCrmCompanyOwnership / assertCrmContactOwnership)
    // have exactly one throw each, keyed only on "rows.length === 0" —
    // never a second, more specific error path for "exists elsewhere".
    const companyFn = source.slice(source.indexOf('async function assertCrmCompanyOwnership'), source.indexOf('async function assertCrmContactOwnership'))
    const contactFnStart = source.indexOf('async function assertCrmContactOwnership')
    const contactFn = source.slice(contactFnStart, source.indexOf('\n}', contactFnStart) + 2)
    expect((companyFn.match(/throw new Error/g) ?? []).length).toBe(1)
    expect((contactFn.match(/throw new Error/g) ?? []).length).toBe(1)
  })
})
