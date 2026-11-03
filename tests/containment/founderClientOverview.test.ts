import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Founder OS real-clients bundle — GET /api/admin/founder-clients now reads
// BrainBase's own records (lib/founder/clientOverview.ts) instead of
// proxying to an external backend. Pins:
//   - super_admin only (requireRole), no overview query for anyone else;
//   - registered organisations, HLNA CRM prospects and HLNA Commercial
//     billing are separate and never merged;
//   - HQ CRM/Commercial reads are scoped to the Brainbase HQ organisation id
//     (resolved by slug, server-side), never another organisation's, and
//     never chosen by request input;
//   - an unreadable source is "unavailable" (null), distinct from empty ([]);
//   - money is exact (decimal strings, BigInt arithmetic) and an unreadable
//     amount is reported, never turned into zero;
//   - the CRM list is a bounded page with truthful coverage metadata, and
//     portfolio figures come from a whole-portfolio aggregate.
// Synthetic fixtures only. See founderClientOverviewRealPostgres.test.ts for
// the same SQL executed against a disposable local Postgres.

// ── sql mock: routes each tagged-template query by its text ───────────────
type Call = { text: string; values: unknown[] }
const calls: Call[] = []
let failing = new Set<string>()
let rowsFor: Record<string, unknown[]> = {}

function keyFor(text: string): string {
  if (text.includes('FROM organisations o')) return 'organisations'
  if (text.includes('FROM organisation_modules')) return 'capabilities'
  if (text.includes('FROM implementations')) return 'implementations'
  if (text.includes('FROM managed_services')) return 'managedServices'
  if (text.includes('FROM client_onboarding')) return 'onboarding'
  if (text.includes('FROM client_pipeline')) return 'requests'
  if (text.includes('FROM web_service_leads')) return 'webLeads'
  if (text.includes('FROM crm_deals d')) return 'hlnaCrmSummary'
  if (text.includes('FROM crm_companies c')) return 'hlnaCrm'
  if (text.includes('FROM commercial_customers')) return 'hlnaCommercial'
  return 'unknown'
}

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('?')
  calls.push({ text, values })
  const key = keyFor(text)
  if (failing.has(key)) return Promise.reject(new Error(`relation for ${key} unavailable`))
  if (key === 'hlnaCrmSummary') return Promise.resolve(rowsFor[key] ?? [CRM_SUMMARY_EMPTY])
  return Promise.resolve(rowsFor[key] ?? [])
})
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const requireRoleMock = vi.fn()
vi.mock('@/lib/org', () => ({ requireRole: (...args: unknown[]) => requireRoleMock(...args) }))

const auditMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
vi.mock('@/lib/admin/auditLog', () => ({ logFounderReadAccessed: (...args: unknown[]) => auditMock(...args) }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const { buildFounderClientOverview, loadFounderClientOverview, resolveHlnaWorkspace, CRM_PAGE_SIZE } = await import('@/lib/founder/clientOverview')
const { GET } = await import('@/app/api/admin/founder-clients/route')
const exact = await import('@/lib/founder/exactMoney')

const CRM_SUMMARY_EMPTY = { total_companies: 0, companies_with_open_deals: 0, open_deals: 0, open_deal_value: '0', won_deals: 0 }
const HQ = { id: 'hq-1', name: 'Brainbase', slug: 'brainbase', status: 'active', plan: 'internal', created_at: '2026-01-01', user_count: 1 }
const ORG_A = { id: 'org-a', name: 'Alpha Synthetic', slug: 'alpha', status: 'active', plan: 'starter', created_at: '2026-02-01', user_count: 3 }
const ORG_B = { id: 'org-b', name: 'Beta Synthetic', slug: 'beta', status: 'trial', plan: 'trial', created_at: '2026-03-01', user_count: 0 }

function req(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/admin/founder-clients${query}`)
}

beforeEach(() => {
  calls.length = 0
  failing = new Set()
  rowsFor = { organisations: [HQ, ORG_A, ORG_B] }
  sqlMock.mockClear()
  requireRoleMock.mockReset()
  auditMock.mockClear()
  fetchMock.mockReset()
})

const EMPTY_CRM = { summary: CRM_SUMMARY_EMPTY, companies: [] }
const EMPTY_ROWS = {
  organisations: [], capabilities: [], implementations: [], managedServices: [], onboarding: [],
  requests: [], hlnaCrm: EMPTY_CRM, webLeads: [], hlnaCommercial: [],
}
const NULL_ROWS = {
  organisations: null, capabilities: null, implementations: null, managedServices: null, onboarding: null,
  requests: null, hlnaCrm: null, webLeads: null, hlnaCommercial: null,
}
const OPTS = {
  excludeOrganisationIds: ['hq-1'],
  hlnaOrganisation: { id: 'hq-1', name: 'Brainbase' },
  hlnaWorkspace: { active: true, switchTo: 'none' as const },
}

describe('buildFounderClientOverview — unavailable vs empty', () => {
  it('every unreadable source is null + "unavailable", never an empty list or zero', () => {
    const o = buildFounderClientOverview(NULL_ROWS, OPTS)
    expect(Object.values(o.sources).every(s => s === 'unavailable')).toBe(true)
    expect(o.registeredOrganisations).toBeNull()
    expect(o.prospects.crmCompanies).toBeNull()
    expect(o.prospects.crmSummary).toBeNull()
    expect(o.prospects.crmPage).toBeNull()
    expect(o.prospects.webLeadsByStatus).toBeNull()
    expect(o.billing.customers).toBeNull()
    expect(o.billing.totals).toBeNull()
    expect(o.billing.unreadableAmountRows).toBeNull()
    expect(o.unlinkedManagedServices).toBeNull()
  })

  it('genuinely empty sources are [] + "ok"', () => {
    const o = buildFounderClientOverview(EMPTY_ROWS, OPTS)
    expect(Object.values(o.sources).every(s => s === 'ok')).toBe(true)
    expect(o.registeredOrganisations).toEqual([])
    expect(o.prospects.crmCompanies).toEqual([])
    expect(o.prospects.crmPage).toMatchObject({ totalCompanies: 0, complete: true, hasNext: false })
    expect(o.billing.customers).toEqual([])
    expect(o.billing.totals).toEqual([])
    expect(o.billing.unreadableAmountRows).toBe(0)
  })

  it('a per-organisation field whose source failed is null/undefined, not zero', () => {
    const o = buildFounderClientOverview({ ...NULL_ROWS, organisations: [ORG_A] }, OPTS)
    const a = o.registeredOrganisations![0]
    expect(a.capabilities).toBeNull()
    expect(a.implementations).toBeNull()
    expect(a.managedServices).toBeNull()
    expect(a.openRequests).toBeNull()
    expect(a.onboarding).toBeUndefined()
  })
})

describe('buildFounderClientOverview — registered organisations', () => {
  it('excludes the HQ/home organisation, keeps stable ids and links to existing screens', () => {
    const o = buildFounderClientOverview({
      ...EMPTY_ROWS,
      organisations: [HQ, ORG_A, ORG_B],
      capabilities: [{ organisation_id: 'org-a', key: 'crm', name: 'CRM' }],
      implementations: [
        { id: 'i-cancel', organisation_id: 'org-a', name: 'Old', stage: 'cancelled', health: null, next_action: null, target_launch_date: null },
        { id: 'i-1', organisation_id: 'org-a', name: 'Portal', stage: 'build', health: 'at_risk', next_action: 'Confirm scope', target_launch_date: '2026-12-01' },
        { id: 'i-2', organisation_id: 'org-a', name: 'Second', stage: 'planning', health: 'on_track', next_action: null, target_launch_date: null },
      ],
      managedServices: [
        { organisation_id: 'org-a', status: 'active', monthly_value: '300.10' },
        { organisation_id: 'org-a', status: 'active', monthly_value: '0.20' },
        { organisation_id: 'org-a', status: 'cancelled', monthly_value: '999.00' },
        { organisation_id: null, status: 'active', monthly_value: '50.00' },
      ],
      onboarding: [{ id: 'ob-1', organisation_id: 'org-b', onboarding_stage: 'design', target_launch_date: null }],
      requests: [{ organisation_id: 'org-a', count: 2 }],
    }, { ...OPTS, excludeOrganisationIds: ['hq-1', 'home-1'] })

    expect(o.registeredOrganisations!.map(r => r.id)).toEqual(['org-a', 'org-b'])
    const a = o.registeredOrganisations![0]
    expect(a.capabilities).toEqual([{ key: 'crm', name: 'CRM' }])
    expect(a.implementations).toEqual({ activeCount: 2, primary: expect.objectContaining({ id: 'i-1', stage: 'build', nextAction: 'Confirm scope' }) })
    // Exact cents: 300.10 + 0.20 = 300.30 (no float drift).
    expect(a.managedServices).toEqual({ activeCount: 2, contractedMonthlyCents: '30030', unreadableValueCount: 0 })
    expect(a.openRequests).toBe(2)
    expect(a.onboarding).toBeNull()
    expect(a.links).toEqual({
      workspace: '/clients/org-a',
      implementation: '/admin/implementations/i-1',
      services: '/admin/deployments',
      requests: '/admin/pipeline',
    })
    const b = o.registeredOrganisations![1]
    expect(b.onboarding).toEqual({ id: 'ob-1', stage: 'design', targetLaunchDate: null })
    expect(b.links.implementation).toBeNull()
    expect(b.links.services).toBeNull()
    expect(o.unlinkedManagedServices).toEqual({ activeCount: 1, contractedMonthlyCents: '5000', unreadableValueCount: 0 })
  })

  it('an unreadable contracted value is counted, never added as zero', () => {
    const o = buildFounderClientOverview({
      ...EMPTY_ROWS,
      organisations: [ORG_A],
      managedServices: [
        { organisation_id: 'org-a', status: 'active', monthly_value: '100.00' },
        { organisation_id: 'org-a', status: 'active', monthly_value: null },
        { organisation_id: 'org-a', status: 'active', monthly_value: 'abc' },
        { organisation_id: 'org-a', status: 'active', monthly_value: '-5.00' },
        { organisation_id: 'org-a', status: 'active', monthly_value: '1.005' },
      ],
    }, OPTS)
    expect(o.registeredOrganisations![0].managedServices).toEqual({ activeCount: 5, contractedMonthlyCents: '10000', unreadableValueCount: 4 })
  })

  it('a plan/status label never turns an organisation into a paying customer', () => {
    const o = buildFounderClientOverview({ ...EMPTY_ROWS, organisations: [{ ...ORG_A, plan: 'paid' }] }, OPTS)
    expect(o.billing.customers).toEqual([])
    expect(o.registeredOrganisations![0]).not.toHaveProperty('relationship')
  })
})

describe('buildFounderClientOverview — exact billing money', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'cu-x', name: 'X', active: true, crm_company_id: null, currency: 'AUD', issued_count: 1,
    invoiced_cents: '0', received_cents: '0', outstanding_cents: '0', part_paid_count: 0, last_issue_date: '2026-10-01',
    ...over,
  })
  const commercial = [
    // Partial payment: 1,100.00 invoiced, 500.00 allocated → 600.00 outstanding, one part-paid invoice.
    row({ id: 'cu-pay', name: 'Payer', crm_company_id: 'co-1', issued_count: 2, invoiced_cents: '110000', received_cents: '50000', outstanding_cents: '60000', part_paid_count: 1 }),
    row({ id: 'cu-pay', name: 'Payer', crm_company_id: 'co-1', currency: 'NZD', invoiced_cents: '20000', outstanding_cents: '20000', last_issue_date: '2026-10-05' }),
    row({ id: 'cu-inv', name: 'Invoiced Only', invoiced_cents: '30000', outstanding_cents: '30000', last_issue_date: '2026-09-01' }),
    { id: 'cu-none', name: 'Record Only', active: false, crm_company_id: null, currency: null, issued_count: null, invoiced_cents: null, received_cents: null, outstanding_cents: null, part_paid_count: null, last_issue_date: null },
  ]

  it('keeps every amount as an exact string, per currency, with allocated-received labelled separately', () => {
    const o = buildFounderClientOverview({ ...EMPTY_ROWS, hlnaCommercial: commercial }, OPTS)
    const byId = Object.fromEntries(o.billing.customers!.map(c => [c.id, c]))
    expect(byId['cu-pay'].relationship).toBe('paying')
    expect(byId['cu-pay'].issuedInvoiceCount).toBe(3)
    expect(byId['cu-pay'].lastIssueDate).toBe('2026-10-05')
    expect(byId['cu-pay'].amounts).toEqual([
      { currency: 'AUD', invoicedCents: '110000', allocatedReceivedCents: '50000', outstandingCents: '60000', partPaidInvoiceCount: 1 },
      { currency: 'NZD', invoicedCents: '20000', allocatedReceivedCents: '0', outstandingCents: '20000', partPaidInvoiceCount: 0 },
    ])
    expect(byId['cu-inv'].relationship).toBe('invoiced')
    expect(byId['cu-none'].relationship).toBe('no_issued_invoices')
    expect(byId['cu-none'].amounts).toEqual([])
    expect(byId['cu-pay'].href).toBe('/commercial/customers/cu-pay')
    expect(o.billing.totals).toEqual([
      { currency: 'AUD', invoicedCents: '140000', allocatedReceivedCents: '50000', outstandingCents: '90000', partPaidInvoiceCount: 1 },
      { currency: 'NZD', invoicedCents: '20000', allocatedReceivedCents: '0', outstandingCents: '20000', partPaidInvoiceCount: 0 },
    ])
    expect(o.billing.unreadableAmountRows).toBe(0)
  })

  it('sums above Number.MAX_SAFE_INTEGER exactly (BigInt), without precision loss', () => {
    const big = '9007199254740993' // MAX_SAFE_INTEGER + 2 — not representable as a JS number
    expect(Number.isSafeInteger(Number(big))).toBe(false)
    const o = buildFounderClientOverview({ ...EMPTY_ROWS, hlnaCommercial: [
      row({ id: 'cu-a', invoiced_cents: big, received_cents: '1', outstanding_cents: '9007199254740992' }),
      row({ id: 'cu-b', invoiced_cents: big, received_cents: big, outstanding_cents: '0' }),
    ] }, OPTS)
    expect(o.billing.totals).toEqual([
      { currency: 'AUD', invoicedCents: '18014398509481986', allocatedReceivedCents: '9007199254740994', outstandingCents: '9007199254740992', partPaidInvoiceCount: 0 },
    ])
    expect(JSON.parse(JSON.stringify(o.billing.totals))[0].invoicedCents).toBe('18014398509481986')
    expect(exact.formatCents('18014398509481986', 'AUD')).toBe('$180,143,985,094,819.86')
  })

  it.each([
    ['a fractional cent amount', { invoiced_cents: '12.5' }],
    ['a negative amount', { received_cents: '-5' }],
    ['a non-numeric amount', { outstanding_cents: 'NaN' }],
    ['a missing amount on an issued row', { invoiced_cents: null }],
    ['an imprecise JS number', { invoiced_cents: 2 ** 60 }],
    ['a malformed currency', { currency: 'aud' }],
    ['a missing currency on an issued row', { currency: null }],
  ])('%s is reported as unreadable and excluded from totals — never zero', (_label, over) => {
    const o = buildFounderClientOverview({ ...EMPTY_ROWS, hlnaCommercial: [
      row({ id: 'cu-ok', invoiced_cents: '1000', outstanding_cents: '1000' }),
      row({ id: 'cu-bad', ...over }),
    ] }, OPTS)
    const bad = o.billing.customers!.find(c => c.id === 'cu-bad')!
    expect(bad.amounts).toEqual([])
    expect(bad.unreadableAmountRows).toBe(1)
    expect(bad.relationship).toBe('unreadable')
    expect(o.billing.unreadableAmountRows).toBe(1)
    expect(o.billing.totals).toEqual([
      { currency: 'AUD', invoicedCents: '1000', allocatedReceivedCents: '0', outstandingCents: '1000', partPaidInvoiceCount: 0 },
    ])
  })

  it('CRM pipeline estimates are never added to invoiced/received totals; the CRM↔Commercial link is reported only from crm_company_id', () => {
    const crm = {
      summary: { total_companies: 2, companies_with_open_deals: 1, open_deals: 2, open_deal_value: '15000.50', won_deals: 1 },
      companies: [
        { id: 'co-1', name: 'Payer Pty', open_deals: 0, open_deal_value: '0', won_deals: 1, latest_open_stage: null },
        { id: 'co-2', name: 'Prospect Pty', open_deals: 2, open_deal_value: '15000.50', won_deals: 0, latest_open_stage: 'proposal' },
      ],
    }
    const o = buildFounderClientOverview({ ...EMPTY_ROWS, hlnaCommercial: commercial, hlnaCrm: crm }, OPTS)
    expect(o.billing.totals!.map(t => t.invoicedCents)).toEqual(['140000', '20000'])
    const [payer, prospect] = o.prospects.crmCompanies!
    expect(payer.commercialCustomerId).toBe('cu-pay')
    expect(prospect.commercialCustomerId).toBeNull()
    expect(prospect.openDealValue).toBe('15000.5')
    expect(prospect.href).toBe('/crm/companies/co-2')
    expect(o.prospects.crmSummary!.openDealValue).toBe('15000.5')
  })

  it('an unreadable deal value is null, not zero', () => {
    const o = buildFounderClientOverview({ ...EMPTY_ROWS, hlnaCrm: {
      summary: { ...CRM_SUMMARY_EMPTY, total_companies: 1, open_deal_value: '-3' },
      companies: [{ id: 'co-1', name: 'C', open_deals: 1, open_deal_value: 'oops', won_deals: 0, latest_open_stage: 'lead' }],
    } }, OPTS)
    expect(o.prospects.crmCompanies![0].openDealValue).toBeNull()
    expect(o.prospects.crmCompanies![0].invalidOpenDealValues).toBe(0)
    expect(o.prospects.crmSummary!.openDealValue).toBeNull()
  })

  it('with the Commercial ledger unavailable, prospects make no billing claim', () => {
    const o = buildFounderClientOverview({ ...EMPTY_ROWS, hlnaCommercial: null, hlnaCrm: { summary: { ...CRM_SUMMARY_EMPTY, total_companies: 1 }, companies: [{ id: 'co-1', name: 'C', open_deals: 0, open_deal_value: '0', won_deals: 0 }] } }, OPTS)
    expect(o.prospects.crmCompanies!.every(p => p.commercialCustomerId === null)).toBe(true)
    expect(o.sources.hlnaCommercial).toBe('unavailable')
  })
})

describe('exactMoney helpers', () => {
  it('parse only exact, non-negative values', () => {
    expect(exact.parseCentsString('000123')).toBe('123')
    expect(exact.parseCentsString(42)).toBe('42')
    expect(exact.parseCentsString(BigInt('9007199254740993'))).toBe('9007199254740993')
    for (const bad of ['1.5', '-1', '', ' ', 'NaN', '1e3', null, undefined, 1.5, -1, 2 ** 60, Number.NaN, {}]) {
      expect(exact.parseCentsString(bad)).toBeNull()
    }
    expect(exact.parseDollarsToCents('300.10')).toBe('30010')
    expect(exact.parseDollarsToCents('7')).toBe('700')
    expect(exact.parseDollarsToCents('1.500')).toBe('150')
    expect(exact.parseDollarsToCents('1.005')).toBeNull()
    expect(exact.parseDecimalString('0012.3400')).toBe('12.34')
  })

  it('format exactly', () => {
    expect(exact.formatCents('123456', 'AUD')).toBe('$1,234.56')
    expect(exact.formatCents('5', null)).toBe('$0.05')
    expect(exact.formatCents('100', 'ZZZ')).toMatch(/1\.00/)
    expect(exact.formatDecimalDollars('1234.5')).toBe('$1,234.50')
  })
})

describe('buildFounderClientOverview — CRM coverage', () => {
  const page = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => ({
    id: `co-${offset + i}`, name: `Company ${offset + i}`, open_deals: 1, open_deal_value: '10', won_deals: 0, latest_open_stage: 'lead',
  }))
  const summary = { total_companies: 523, companies_with_open_deals: 523, open_deals: 523, open_deal_value: '5230', won_deals: 0 }

  it('a capped first page is marked incomplete; portfolio figures come from the aggregate, not the page', () => {
    const o = buildFounderClientOverview({ ...EMPTY_ROWS, hlnaCrm: { summary, companies: page(CRM_PAGE_SIZE) } }, OPTS)
    expect(o.prospects.crmCompanies).toHaveLength(200)
    expect(o.prospects.crmPage).toEqual({ page: 0, pageSize: 200, from: 1, to: 200, totalCompanies: 523, hasPrevious: false, hasNext: true, complete: false })
    expect(o.prospects.crmSummary).toMatchObject({ totalCompanies: 523, companiesWithOpenDeals: 523, openDealValue: '5230' })
  })

  it('the last page reports its true range', () => {
    const o = buildFounderClientOverview({ ...EMPTY_ROWS, hlnaCrm: { summary, companies: page(123, 400) } }, { ...OPTS, crmPage: 2 })
    expect(o.prospects.crmPage).toEqual({ page: 2, pageSize: 200, from: 401, to: 523, totalCompanies: 523, hasPrevious: true, hasNext: false, complete: false })
  })

  it('a portfolio that fits on one page is complete', () => {
    const o = buildFounderClientOverview({ ...EMPTY_ROWS, hlnaCrm: { summary: { ...summary, total_companies: 3 }, companies: page(3) } }, OPTS)
    expect(o.prospects.crmPage).toMatchObject({ complete: true, hasNext: false, from: 1, to: 3 })
  })
})

describe('resolveHlnaWorkspace — from the authoritative session only', () => {
  it.each([
    [null, 'home', 'home', { active: false, switchTo: 'unavailable' }],
    ['hq-1', 'hq-1', 'hq-1', { active: true, switchTo: 'none' }],
    ['hq-1', 'hq-1', 'org-a', { active: false, switchTo: 'stop_viewing_as' }],
    ['hq-1', 'home-x', 'org-a', { active: false, switchTo: 'view_as_hlna' }],
    ['hq-1', 'home-x', 'hq-1', { active: true, switchTo: 'none' }],
  ])('hq=%s home=%s active=%s', (hq, home, active, expected) => {
    expect(resolveHlnaWorkspace(hq, { homeOrganisationId: home, activeOrganisationId: active })).toEqual(expected)
  })
})

describe('loadFounderClientOverview — organisation scoping', () => {
  it('scopes HQ CRM and Commercial reads to the HQ organisation resolved by slug, and excludes HQ + home from the client list', async () => {
    const o = await loadFounderClientOverview({ homeOrganisationId: 'org-b', activeOrganisationId: 'org-b' })
    expect(o.hlnaOrganisation).toEqual({ id: 'hq-1', name: 'Brainbase' })
    expect(o.registeredOrganisations!.map(r => r.id)).toEqual(['org-a'])
    expect(o.hlnaWorkspace).toEqual({ active: false, switchTo: 'view_as_hlna' })

    const crm = calls.find(c => keyFor(c.text) === 'hlnaCrm')!
    const crmSummary = calls.find(c => keyFor(c.text) === 'hlnaCrmSummary')!
    const commercial = calls.find(c => keyFor(c.text) === 'hlnaCommercial')!
    expect(crm.values).toContain('hq-1')
    expect(crm.text).toMatch(/WHERE c\.organisation_id = \?/)
    expect(crm.text).toMatch(/d\.organisation_id = c\.organisation_id/)
    expect(crm.text).toMatch(/LIMIT \? OFFSET \?/)
    expect(crmSummary.text).toMatch(/WHERE d\.organisation_id = \?/)
    // Every organisation-id parameter on the HQ queries is the HQ id.
    for (const c of [crm, crmSummary, commercial]) {
      expect(c.values.filter(v => typeof v === 'string' && /^(org-|hq-|home-)/.test(v)).every(v => v === 'hq-1')).toBe(true)
    }
    expect((commercial.text.match(/organisation_id = \?/g) ?? []).length).toBe(3)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('money SQL is exact: NUMERIC aggregates returned as text, no BIGINT/float casts, RECORDED payments only, per-invoice outstanding', async () => {
    await loadFounderClientOverview({ homeOrganisationId: 'hq-1', activeOrganisationId: 'hq-1' })
    const commercial = calls.find(c => keyFor(c.text) === 'hlnaCommercial')!.text
    const crm = calls.find(c => keyFor(c.text) === 'hlnaCrm')!.text
    const crmSummary = calls.find(c => keyFor(c.text) === 'hlnaCrmSummary')!.text
    const services = calls.find(c => keyFor(c.text) === 'managedServices')!.text
    for (const text of [commercial, crm, crmSummary, services]) {
      expect(text).not.toMatch(/::bigint|::float|::real|::double/)
    }
    expect(commercial).toContain("p.status = 'RECORDED'")
    expect(commercial).toContain("i.status = 'ISSUED'")
    expect(commercial).toContain('SUM(i.total_cents::numeric)::text AS invoiced_cents')
    expect(commercial).toContain('SUM(a.allocated_amount_cents::numeric)')
    expect(commercial).toMatch(/GREATEST\(i\.total_cents::numeric - COALESCE\(alloc\.allocated, 0\), 0\)/)
    expect(crm).toMatch(/SUM\(d\.value\)[\s\S]*?::text AS open_deal_value/)
    expect(services).toContain('monthly_value::text')
    // Individual deal values are validated BEFORE SUM (no negative/NaN/Infinity offsetting), in both CRM queries.
    for (const text of [crm, crmSummary]) {
      expect(text).toContain("SUM(d.value) FILTER (WHERE d.stage <> ALL(?::text[]) AND d.value >= 0 AND d.value < 'Infinity'::numeric), 0)::text AS open_deal_value")
      expect(text).not.toMatch(/SUM\(d\.value\) FILTER \(WHERE d\.stage <> ALL\(\?::text\[\]\)\), 0\)/)
      expect(text).toContain("AND d.value IS NOT NULL AND NOT (d.value >= 0 AND d.value < 'Infinity'::numeric))::int AS invalid_open_deal_values")
    }
  })

  it('crmPage only moves the bounded OFFSET; out-of-range values fall back to page 0', async () => {
    await loadFounderClientOverview({ homeOrganisationId: 'hq-1', activeOrganisationId: 'hq-1', crmPage: 2 })
    expect(calls.find(c => keyFor(c.text) === 'hlnaCrm')!.values.slice(-2)).toEqual([200, 400])
    calls.length = 0
    await loadFounderClientOverview({ homeOrganisationId: 'hq-1', activeOrganisationId: 'hq-1', crmPage: -1 })
    expect(calls.find(c => keyFor(c.text) === 'hlnaCrm')!.values.slice(-2)).toEqual([200, 0])
  })

  it('with no HQ organisation, HLNA CRM and Commercial are unavailable, never queried, and links cannot open', async () => {
    rowsFor = { organisations: [ORG_A, ORG_B] }
    const o = await loadFounderClientOverview({ homeOrganisationId: 'home-x', activeOrganisationId: 'home-x' })
    expect(o.hlnaOrganisation).toBeNull()
    expect(o.hlnaWorkspace).toEqual({ active: false, switchTo: 'unavailable' })
    expect(o.sources.hlnaCrm).toBe('unavailable')
    expect(o.sources.hlnaCommercial).toBe('unavailable')
    expect(calls.some(c => /crm_|commercial_/.test(c.text))).toBe(false)
    expect(o.registeredOrganisations!.map(r => r.id)).toEqual(['org-a', 'org-b'])
  })

  it('one failing source is isolated; the others still load', async () => {
    failing = new Set(['implementations'])
    const o = await loadFounderClientOverview({ homeOrganisationId: 'hq-1', activeOrganisationId: 'hq-1' })
    expect(o.sources.implementations).toBe('unavailable')
    expect(o.sources.organisations).toBe('ok')
    expect(o.sources.hlnaCommercial).toBe('ok')
    expect(o.registeredOrganisations![0].implementations).toBeNull()
  })

  it('a failing CRM aggregate makes the whole CRM source unavailable — a page is never shown without its totals', async () => {
    failing = new Set(['hlnaCrmSummary'])
    rowsFor.hlnaCrm = [{ id: 'co-1', name: 'C', open_deals: 0, open_deal_value: '0', won_deals: 0 }]
    const o = await loadFounderClientOverview({ homeOrganisationId: 'hq-1', activeOrganisationId: 'hq-1' })
    expect(o.sources.hlnaCrm).toBe('unavailable')
    expect(o.prospects.crmCompanies).toBeNull()
    expect(o.prospects.crmSummary).toBeNull()
  })

  it('organisations failing leaves the client list unavailable (not empty) and the HQ ledger unreadable', async () => {
    failing = new Set(['organisations'])
    const o = await loadFounderClientOverview({ homeOrganisationId: 'hq-1', activeOrganisationId: 'hq-1' })
    expect(o.registeredOrganisations).toBeNull()
    expect(o.sources.hlnaCrm).toBe('unavailable')
    expect(o.sources.hlnaCommercial).toBe('unavailable')
  })
})

describe('GET /api/admin/founder-clients — permissions and audit', () => {
  it('403 for anyone below super_admin, with no overview query and no audit', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(requireRoleMock).toHaveBeenCalledWith('super_admin')
    expect(sqlMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('403 comes before any query-parameter handling', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await GET(req('?crmPage=abc&orgId=hq-1'))
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('super_admin impersonating another organisation: excludes the true home organisation (not the impersonated one), says CRM/Commercial need a switch, audits "live", not cacheable', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'sa-1', organisationId: 'org-a', homeOrganisationId: 'hq-1', role: 'super_admin' })
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await res.json()
    // Impersonating org-a must not hide org-a from the list.
    expect(body.registeredOrganisations.map((r: { id: string }) => r.id)).toEqual(['org-a', 'org-b'])
    // HQ is the founder's home; links must clear the override, never open org-a's CRM.
    expect(body.hlnaWorkspace).toEqual({ active: false, switchTo: 'stop_viewing_as' })
    expect(auditMock.mock.calls[0]?.[0]).toMatchObject({ actorUserId: 'sa-1', actorOrganisationId: 'org-a', resource: 'founder_clients', source: 'live' })
    expect(JSON.stringify(auditMock.mock.calls[0]?.[0])).not.toContain('Alpha Synthetic')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an organisation id in the query string is ignored — workspace and scope come only from the session', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'sa-1', organisationId: 'org-a', homeOrganisationId: 'hq-1', role: 'super_admin' })
    const res = await GET(req('?orgId=hq-1&organisationId=hq-1'))
    const body = await res.json()
    expect(body.hlnaWorkspace).toEqual({ active: false, switchTo: 'stop_viewing_as' })
    for (const c of calls) expect(c.values).not.toContain('org-a')
  })

  it.each(['abc', '-1', '1.5', '99999', '10001'])('rejects crmPage=%s with 400 and no query', async v => {
    requireRoleMock.mockResolvedValue({ userId: 'sa-1', organisationId: 'hq-1', homeOrganisationId: 'hq-1', role: 'super_admin' })
    const res = await GET(req(`?crmPage=${encodeURIComponent(v)}`))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('a valid crmPage selects the page offset', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'sa-1', organisationId: 'hq-1', homeOrganisationId: 'hq-1', role: 'super_admin' })
    const res = await GET(req('?crmPage=1'))
    expect(res.status).toBe(200)
    expect(calls.find(c => keyFor(c.text) === 'hlnaCrm')!.values.slice(-2)).toEqual([200, 200])
    expect((await res.json()).hlnaWorkspace).toEqual({ active: true, switchTo: 'none' })
  })

  it('audits "fallback" when the organisations source is unavailable, and still answers 200 with explicit source status', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'sa-1', organisationId: 'hq-1', homeOrganisationId: 'hq-1', role: 'super_admin' })
    failing = new Set(['organisations'])
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sources.organisations).toBe('unavailable')
    expect(body.registeredOrganisations).toBeNull()
    expect(auditMock.mock.calls[0]?.[0]).toMatchObject({ source: 'fallback' })
  })
})
