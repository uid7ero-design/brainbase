import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest'
import pg from 'pg'

// Executes the real Founder OS client-overview SQL (lib/founder/
// clientOverview.ts) against a disposable, owned, loopback Postgres with
// synthetic rows only. Opt-in: FOUNDER_OVERVIEW_REAL_PG=1 (needs Docker).
//
// No connection string is accepted from the environment. The run starts its
// OWN container (tests/helpers/ownedDisposablePostgres.ts), labelled with a
// random per-run token, creates a token-named schema with an ownership
// marker, and proves ownership (container label + marker) before every
// destructive statement (TRUNCATE, DROP SCHEMA). Cleanup drops only that
// schema and removes only that container. Tables carry only the columns the
// overview reads, with the production column types that matter for money
// (INTEGER cents, NUMERIC deal/service values).

const state = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }))
vi.mock('@/lib/db', () => {
  type Query = { text: string; values: unknown[]; then: PromiseLike<unknown>['then'] }
  const tag = (strings: TemplateStringsArray, ...inputs: unknown[]): Query => {
    let text = strings[0]
    const values: unknown[] = []
    inputs.forEach((value, i) => { values.push(value); text += '$' + values.length + strings[i + 1] })
    return { text, values, then(resolve, reject) { return state.pool!.query(text, values).then(r => r.rows).then(resolve, reject) } }
  }
  return { default: tag }
})

const { loadFounderClientOverview, CRM_PAGE_SIZE } = await import('@/lib/founder/clientOverview')
const owned = await import('../helpers/ownedDisposablePostgres')

const suite = process.env.FOUNDER_OVERVIEW_REAL_PG === '1' ? describe : describe.skip
let run: import('../helpers/ownedDisposablePostgres').OwnedRun | null = null

const SCHEMA = `
  CREATE TABLE organisations(id text PRIMARY KEY, name text, slug text, status text, plan text, created_at timestamptz DEFAULT now());
  CREATE TABLE users(id text PRIMARY KEY, organisation_id text);
  CREATE TABLE modules(key text PRIMARY KEY, name text, active boolean);
  CREATE TABLE organisation_modules(organisation_id text, module_key text, enabled boolean);
  CREATE TABLE implementations(id text PRIMARY KEY, organisation_id text, name text, stage text, health text, next_action text, target_launch_date date, updated_at timestamptz DEFAULT now());
  CREATE TABLE managed_services(id serial PRIMARY KEY, organisation_id text, status text, monthly_value NUMERIC(10,2) DEFAULT 0);
  CREATE TABLE client_onboarding(id text PRIMARY KEY, organisation_id text, onboarding_stage text, target_launch_date date, updated_at timestamptz DEFAULT now());
  CREATE TABLE client_pipeline(id serial PRIMARY KEY, organisation_id uuid, status text);
  CREATE TABLE web_service_leads(id serial PRIMARY KEY, status text);
  CREATE TABLE crm_companies(id text PRIMARY KEY, organisation_id text, name text);
  CREATE TABLE crm_deals(id text PRIMARY KEY, organisation_id text, company_id text, value numeric, stage text, updated_at timestamptz DEFAULT now());
  CREATE TABLE commercial_customers(id text PRIMARY KEY, organisation_id text, name text, active boolean DEFAULT true, crm_company_id text);
  CREATE TABLE commercial_invoices(id text PRIMARY KEY, organisation_id text, customer_id text, currency text NOT NULL DEFAULT 'AUD', status text, total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0), issue_date date);
  CREATE TABLE commercial_payments(id text PRIMARY KEY, organisation_id text, status text);
  CREATE TABLE commercial_payment_allocations(id serial PRIMARY KEY, organisation_id text, payment_id text, invoice_id text, allocated_amount_cents INTEGER NOT NULL CHECK (allocated_amount_cents > 0));
`
const TABLES = 'organisations,users,modules,organisation_modules,implementations,managed_services,client_onboarding,client_pipeline,web_service_leads,crm_companies,crm_deals,commercial_customers,commercial_invoices,commercial_payments,commercial_payment_allocations'

suite('Founder client overview SQL on a disposable local Postgres', () => {
  beforeAll(async () => {
    run = await owned.startOwnedPostgres()
    // Unqualified table names in the overview SQL resolve to this run's schema.
    state.pool = new pg.Pool({ connectionString: run.connectionString, options: `-c search_path=${run.schema}` })
    await owned.claimRunSchema(state.pool, run)
    await owned.assertRunOwnership(state.pool, run)
    await state.pool.query(SCHEMA)
  }, 120_000)
  afterAll(async () => {
    try {
      if (state.pool && run) await owned.dropOwnedSchema(state.pool, run)
    } finally {
      await state.pool?.end()
      if (run) await owned.stopOwnedContainer(run)
    }
  }, 60_000)
  beforeEach(async () => {
    await owned.assertRunOwnership(state.pool!, run!)
    await state.pool!.query(`TRUNCATE ${TABLES.split(',').map(t => `${run!.schema}.${t}`).join(',')}`)
    await state.pool!.query(`
      INSERT INTO organisations(id, name, slug, status, plan) VALUES
        ('hq', 'HLNA Labs', 'brainbase', 'active', 'internal'),
        ('org-a', 'Alpha Synthetic', 'alpha', 'active', 'paid');
      INSERT INTO managed_services(organisation_id, status, monthly_value) VALUES
        ('org-a', 'active', 300.10), ('org-a', 'active', 0.20), ('org-a', 'cancelled', 999.00);
    `)
  })

  it('billing: partial payments, reversals excluded, drafts/voids excluded, per currency, other organisations never counted', async () => {
    await state.pool!.query(`
      INSERT INTO commercial_customers(id, organisation_id, name, crm_company_id) VALUES
        ('cu1', 'hq', 'Payer', 'co1'), ('cu2', 'hq', 'Record only', null), ('cuX', 'org-a', 'Foreign customer', null);
      INSERT INTO commercial_invoices(id, organisation_id, customer_id, currency, status, total_cents, issue_date) VALUES
        ('i1', 'hq', 'cu1', 'AUD', 'ISSUED', 100000, '2026-10-01'),
        ('i2', 'hq', 'cu1', 'AUD', 'ISSUED', 50000, '2026-10-02'),
        ('i3', 'hq', 'cu1', 'NZD', 'ISSUED', 20000, '2026-10-03'),
        ('i4', 'hq', 'cu1', 'AUD', 'DRAFT', 999, null),
        ('i5', 'hq', 'cu1', 'AUD', 'VOID', 777, '2026-09-01'),
        ('i6', 'org-a', 'cuX', 'AUD', 'ISSUED', 123456, '2026-10-01');
      INSERT INTO commercial_payments(id, organisation_id, status) VALUES
        ('p1', 'hq', 'RECORDED'), ('p2', 'hq', 'REVERSED'), ('p3', 'org-a', 'RECORDED');
      INSERT INTO commercial_payment_allocations(organisation_id, payment_id, invoice_id, allocated_amount_cents) VALUES
        ('hq', 'p1', 'i1', 30000),
        ('hq', 'p1', 'i2', 50000),
        ('hq', 'p2', 'i1', 70000),
        ('org-a', 'p3', 'i6', 123456);
    `)
    const o = await loadFounderClientOverview({ homeOrganisationId: 'hq', activeOrganisationId: 'org-a' })
    expect(o.sources.hlnaCommercial).toBe('ok')
    expect(o.billing.customers!.map(c => c.id).sort()).toEqual(['cu1', 'cu2'])
    const cu1 = o.billing.customers!.find(c => c.id === 'cu1')!
    expect(cu1.relationship).toBe('paying')
    expect(cu1.issuedInvoiceCount).toBe(3)
    expect(cu1.amounts).toEqual([
      { currency: 'AUD', invoicedCents: '150000', allocatedReceivedCents: '80000', outstandingCents: '70000', partPaidInvoiceCount: 1 },
      { currency: 'NZD', invoicedCents: '20000', allocatedReceivedCents: '0', outstandingCents: '20000', partPaidInvoiceCount: 0 },
    ])
    expect(o.billing.customers!.find(c => c.id === 'cu2')!.relationship).toBe('no_issued_invoices')
    expect(o.billing.unreadableAmountRows).toBe(0)
    expect(o.registeredOrganisations!.find(r => r.id === 'org-a')!.managedServices).toEqual({ activeCount: 2, contractedMonthlyCents: '30030', unreadableValueCount: 0 })
    expect(o.hlnaWorkspace).toEqual({ active: false, switchTo: 'stop_viewing_as' })
  })

  it('CRM: more than 200 companies are paged with truthful coverage; portfolio totals are exact and HQ-only', async () => {
    await state.pool!.query(`
      INSERT INTO crm_companies(id, organisation_id, name)
        SELECT 'co' || lpad(g::text, 4, '0'), 'hq', 'Company ' || lpad(g::text, 4, '0') FROM generate_series(1, 523) g;
      INSERT INTO crm_deals(id, organisation_id, company_id, value, stage)
        SELECT 'd' || g, 'hq', 'co' || lpad(g::text, 4, '0'), 0.10, 'lead' FROM generate_series(1, 523) g;
      INSERT INTO crm_deals(id, organisation_id, company_id, value, stage) VALUES
        ('won1', 'hq', 'co0001', 5000, 'closed_won'),
        ('nullv', 'hq', 'co0002', NULL, 'proposal');
      INSERT INTO crm_companies(id, organisation_id, name)
        SELECT 'fx' || g, 'org-a', 'Foreign ' || g FROM generate_series(1, 50) g;
      INSERT INTO crm_deals(id, organisation_id, company_id, value, stage)
        SELECT 'fd' || g, 'org-a', 'fx' || g, 1000000, 'lead' FROM generate_series(1, 50) g;
    `)
    const first = await loadFounderClientOverview({ homeOrganisationId: 'hq', activeOrganisationId: 'hq' })
    expect(first.prospects.crmCompanies).toHaveLength(CRM_PAGE_SIZE)
    expect(first.prospects.crmPage).toEqual({ page: 0, pageSize: 200, from: 1, to: 200, totalCompanies: 523, hasPrevious: false, hasNext: true, complete: false })
    expect(first.prospects.crmSummary).toEqual({ totalCompanies: 523, companiesWithOpenDeals: 523, openDeals: 524, openDealValue: '52.3', openDealsWithoutValue: 1, invalidOpenDealValues: 0, wonDeals: 1 })
    expect(first.prospects.crmCompanies!.every(c => c.id.startsWith('co'))).toBe(true)

    const last = await loadFounderClientOverview({ homeOrganisationId: 'hq', activeOrganisationId: 'hq', crmPage: 2 })
    expect(last.prospects.crmCompanies).toHaveLength(123)
    expect(last.prospects.crmPage).toMatchObject({ from: 401, to: 523, hasNext: false, hasPrevious: true, complete: false })
    expect(last.prospects.crmCompanies!.at(-1)!.id).toBe('co0523')

    const ids = new Set<string>()
    for (const page of [0, 1, 2]) {
      const o = await loadFounderClientOverview({ homeOrganisationId: 'hq', activeOrganisationId: 'hq', crmPage: page })
      for (const c of o.prospects.crmCompanies!) ids.add(c.id)
    }
    expect(ids.size).toBe(523)
  })

  it('CRM deal values are validated individually before summing: a negative never offsets a valid value', async () => {
    await state.pool!.query(`
      INSERT INTO crm_companies(id, organisation_id, name) VALUES ('c1', 'hq', 'Company One');
      INSERT INTO crm_deals(id, organisation_id, company_id, value, stage) VALUES
        ('ok', 'hq', 'c1', 100, 'lead'),
        ('neg', 'hq', 'c1', -20, 'proposal');
    `)
    const o = await loadFounderClientOverview({ homeOrganisationId: 'hq', activeOrganisationId: 'hq' })
    expect(o.prospects.crmCompanies![0]).toMatchObject({ openDeals: 2, openDealValue: '100', openDealsWithoutValue: 0, invalidOpenDealValues: 1 })
    expect(o.prospects.crmSummary).toMatchObject({ openDeals: 2, openDealValue: '100', openDealsWithoutValue: 0, invalidOpenDealValues: 1 })
  })

  it('NULL is reported as missing; NaN, Infinity and -Infinity are excluded as invalid; large positive values stay exact', async () => {
    await state.pool!.query(`
      INSERT INTO crm_companies(id, organisation_id, name) VALUES ('c1', 'hq', 'A'), ('c2', 'hq', 'B');
      INSERT INTO crm_deals(id, organisation_id, company_id, value, stage) VALUES
        ('big1', 'hq', 'c1', 123456789012345678901234567890.12, 'lead'),
        ('big2', 'hq', 'c1', 0.88, 'lead'),
        ('nul', 'hq', 'c1', NULL, 'lead'),
        ('nan', 'hq', 'c2', 'NaN', 'lead'),
        ('inf', 'hq', 'c2', 'Infinity', 'lead'),
        ('ninf', 'hq', 'c2', '-Infinity', 'lead'),
        ('closedneg', 'hq', 'c2', -5, 'closed_lost');
    `)
    const o = await loadFounderClientOverview({ homeOrganisationId: 'hq', activeOrganisationId: 'hq' })
    const [a, b] = o.prospects.crmCompanies!
    expect(a).toMatchObject({ openDeals: 3, openDealValue: '123456789012345678901234567891', openDealsWithoutValue: 1, invalidOpenDealValues: 0 })
    expect(b).toMatchObject({ openDeals: 3, openDealValue: '0', openDealsWithoutValue: 0, invalidOpenDealValues: 3 })
    expect(o.prospects.crmSummary).toMatchObject({
      openDeals: 6, openDealValue: '123456789012345678901234567891', openDealsWithoutValue: 1, invalidOpenDealValues: 3,
    })
  })

  it('aggregates above Number.MAX_SAFE_INTEGER stay exact end to end (no BIGINT/float cast, no JS number)', async () => {
    const n = 4_194_306 // n × INTEGER max > 2^53
    const perInvoice = BigInt(2_147_483_647)
    await state.pool!.query(`
      INSERT INTO commercial_customers(id, organisation_id, name) VALUES ('big', 'hq', 'Big');
      INSERT INTO commercial_invoices(id, organisation_id, customer_id, currency, status, total_cents)
        SELECT 'b' || g, 'hq', 'big', 'AUD', 'ISSUED', 2147483647 FROM generate_series(1, ${n}) g;
    `)
    const o = await loadFounderClientOverview({ homeOrganisationId: 'hq', activeOrganisationId: 'hq' })
    const expected = (perInvoice * BigInt(n)).toString()
    expect(BigInt(expected) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(o.billing.totals).toEqual([
      { currency: 'AUD', invoicedCents: expected, allocatedReceivedCents: '0', outstandingCents: expected, partPaidInvoiceCount: 0 },
    ])
  }, 180_000)
})
