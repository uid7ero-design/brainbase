import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium, expect as browserExpect, type Browser } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';
import { commercialBrowserBundle } from './helpers/commercialBrowserBundle';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname)) throw new Error('Requires a fresh disposable localhost database');
const sql = createNeonCompatibleSql(databaseUrl);
const supplierId = '00000000-0000-0000-0000-000000000101';
const bill1 = '00000000-0000-0000-0000-000000000201';
const bill2 = '00000000-0000-0000-0000-000000000202';
let role: 'admin' | 'viewer' = 'admin';
let organisationId = 'org-a';
let entitled = true;
let authenticated = true;
const recordedAudit = vi.fn(async () => undefined);
vi.doMock('@/lib/db', () => ({ default: sql }));
// Identity/entitlement fixtures replace login infrastructure. The real Commercial
// authorization composition, role ordering, route, domain and SQL all execute.
vi.doMock('@/lib/org', async () => {
  const actual = await vi.importActual<typeof import('@/lib/org')>('@/lib/org');
  return { ...actual, requireSession: async () => {
    if (!authenticated) throw new Error('Unauthorized');
    return { userId: 'user-1', organisationId, homeOrganisationId: organisationId, name: 'AP integration', role };
  } };
});
vi.doMock('@/lib/capabilities/requireCapability', async () => {
  const actual = await vi.importActual<typeof import('@/lib/capabilities/requireCapability')>('@/lib/capabilities/requireCapability');
  return { ...actual, requireCapability: async () => { if (!entitled) throw new Error('Forbidden'); } };
});
vi.doMock('@/lib/commercial/auditLog', () => ({ logSupplierPaymentRecorded: recordedAudit, logSupplierPaymentReversed: vi.fn(async () => undefined) }));
const remittance = await import('@/app/api/commercial/suppliers/[id]/payments/route');
const billPayments = await import('@/app/api/commercial/supplier-bills/[id]/payments/route');
const reversal = await import('@/app/api/commercial/supplier-bills/[id]/payments/[paymentId]/reverse/route');
const overview = await import('@/app/api/commercial/purchasing/ap-overview/route');
const { getSupplierApOverview } = await import('@/lib/commercial/supplierApOverview');

let server: Server;
let browser: Browser;
let origin: string;
let loseNextPaymentResponse = false;
const submittedKeys: string[] = [];
const serverErrors: string[] = [];

beforeAll(async () => {
  await sql.raw('CREATE TABLE organisations(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY)');
  await sql.raw(`CREATE TABLE commercial_suppliers(id UUID PRIMARY KEY, organisation_id TEXT REFERENCES organisations(id), name TEXT, active BOOLEAN, UNIQUE(id,organisation_id))`);
  await sql.raw(`CREATE TABLE commercial_supplier_bills(id UUID PRIMARY KEY, organisation_id TEXT REFERENCES organisations(id), supplier_id UUID, currency TEXT,
    status TEXT, total_cents INTEGER, subtotal_cents INTEGER, tax_cents INTEGER DEFAULT 0, bill_number TEXT, supplier_invoice_number TEXT, due_date DATE,
    created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(id,organisation_id), FOREIGN KEY(supplier_id,organisation_id) REFERENCES commercial_suppliers(id,organisation_id))`);
  await sql.raw('CREATE INDEX idx_ap_readiness_bills_org_status ON commercial_supplier_bills(organisation_id,status)');
  const migration = readFileSync('scripts/create-commercial-supplier-payments.sql', 'utf8').replace(/--.*$/gm, '');
  await sql.raw(migration);
  await sql.raw("INSERT INTO organisations VALUES ('org-a'),('load-org'); INSERT INTO users VALUES ('user-1')");
  await sql.raw(`INSERT INTO commercial_suppliers VALUES ('${supplierId}','org-a','Integration supplier',true)`);
  await sql.raw(`INSERT INTO commercial_supplier_bills(id,organisation_id,supplier_id,currency,status,total_cents,subtotal_cents,bill_number,supplier_invoice_number,due_date)
    VALUES ('${bill1}','org-a','${supplierId}','AUD','POSTED',10000,10000,'SB1','INV1','2026-09-05'),
           ('${bill2}','org-a','${supplierId}','AUD','POSTED',5000,5000,'SB2','INV2',NULL)`);
  const [remittanceBundle, billBundle, overviewBundle] = await Promise.all([
    commercialBrowserBundle('app/commercial/purchasing/suppliers/[id]/remittance/page.tsx', supplierId),
    commercialBrowserBundle('app/commercial/purchasing/supplier-bills/[id]/page.tsx', bill1),
    commercialBrowserBundle('app/commercial/purchasing/ap-overview/page.tsx'),
  ]);
  server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url!, origin);
      if (!url.pathname.startsWith('/api/')) {
        const bundle = url.pathname.includes('supplier-bills') ? billBundle : url.pathname.startsWith('/overview') ? overviewBundle : remittanceBundle;
        if (url.pathname.endsWith('.js')) {
          outgoing.setHeader('Content-Type', 'application/javascript; charset=utf-8'); outgoing.end(bundle); return;
        }
        outgoing.setHeader('Content-Type', 'text/html; charset=utf-8');
        outgoing.end(`<div id="root"></div><script src="${url.pathname}.js"></script>`); return;
      }
      let body = ''; for await (const chunk of incoming) body += chunk.toString();
      const request = new NextRequest(url, { method: incoming.method, headers: incoming.headers as Record<string, string>, body: body || undefined });
      let response: Response;
      const paymentPath = `/api/commercial/suppliers/${supplierId}/payments`;
      const billPath = `/api/commercial/supplier-bills/${bill1}`;
      if (url.pathname === paymentPath) response = await (incoming.method === 'POST' ? remittance.POST : remittance.GET)(request, { params: Promise.resolve({ id: supplierId }) });
      else if (url.pathname === `${billPath}/payments`) response = await (incoming.method === 'POST' ? billPayments.POST : billPayments.GET)(request, { params: Promise.resolve({ id: bill1 }) });
      else if (url.pathname.endsWith('/reverse')) response = await reversal.POST(request, { params: Promise.resolve({ id: bill1, paymentId: url.pathname.split('/').at(-2)! }) });
      else if (url.pathname === '/api/commercial/purchasing/ap-overview') response = await overview.GET(request);
      else if (url.pathname === '/api/me') response = Response.json({ role });
      // Ancillary bill detail/attachment/tax responses are fixtures; all settlement
      // reads/writes and AP overview responses above execute their actual routes.
      else if (url.pathname === billPath) {
        const [bill] = await sql`SELECT * FROM commercial_supplier_bills WHERE id=${bill1} AND organisation_id=${organisationId}`;
        response = Response.json({ supplierBill: bill, lines: [], purchaseOrder: null, purchaseOrderLines: [], billedAmounts: {} });
      } else if (url.pathname.endsWith('/attachments')) response = Response.json({ attachments: [] });
      else if (url.pathname.endsWith('/tax-codes')) response = Response.json({ taxCodes: [] });
      else response = new Response(null, { status: 404 });
      if (incoming.method === 'POST' && url.pathname.endsWith('/payments')) {
        submittedKeys.push(request.headers.get('Idempotency-Key') ?? '');
        if (loseNextPaymentResponse && response.ok) {
          loseNextPaymentResponse = false;
          // Lose the JSON body after the transaction committed. A bare socket
          // reset may be transparently retried by Chromium before fetch rejects.
          outgoing.writeHead(201, { 'Content-Type': 'application/json' }); outgoing.end('{"payment":'); return;
        }
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text());
    } catch (err) { serverErrors.push(String(err)); outgoing.writeHead(500); outgoing.end('Integration server error'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing HTTP port');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
}, 60000);

async function newPage() {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => console.error('AP_BROWSER_ERROR', error.message));
  return page;
}

beforeEach(async () => {
  role = 'admin'; organisationId = 'org-a'; entitled = true; authenticated = true;
  loseNextPaymentResponse = false; submittedKeys.length = 0; serverErrors.length = 0; recordedAudit.mockClear();
  await sql.raw("DELETE FROM commercial_supplier_payment_allocations WHERE organisation_id='org-a'; DELETE FROM commercial_supplier_payments WHERE organisation_id='org-a'");
});
afterEach(async () => { for (const context of browser?.contexts() ?? []) await context.close(); });

afterAll(async () => {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  await sql.end();
});

describe('Supplier AP UI to real HTTP routes to disposable PostgreSQL', () => {
  it('recovers a lost remittance response, then reverses the whole payment through bill history', async () => {
    const page = await newPage(); const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/remittance`);
    await page.getByLabel('Currency').selectOption('AUD');
    await page.getByLabel('Allocate SB1').fill('25'); await page.getByLabel('Allocate SB2').fill('50');
    await page.getByLabel('Payment method').selectOption('BANK_TRANSFER');
    loseNextPaymentResponse = true;
    await page.getByRole('button', { name: 'Record Remittance' }).click();
    await browserExpect(page.getByRole('alert')).toContainText('Check bill payment history');
    expect(await sql.raw('SELECT count(*)::int AS n FROM commercial_supplier_payments')).toEqual([{ n: 1 }]);
    await page.getByRole('button', { name: 'Record Remittance' }).click();
    await browserExpect(page.getByText('Payment recorded: $75.00', { exact: true })).toBeVisible();
    expect(submittedKeys).toHaveLength(2); expect(submittedKeys[0]).toBe(submittedKeys[1]); expect(submittedKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(recordedAudit).toHaveBeenCalledTimes(1);
    expect(await sql.raw('SELECT count(*)::int AS n FROM commercial_supplier_payments')).toEqual([{ n: 1 }]);
    expect(await sql.raw('SELECT count(*)::int AS n FROM commercial_supplier_payment_allocations')).toEqual([{ n: 2 }]);
    await page.getByRole('link', { name: 'View SB1 payment history' }).click();
    await browserExpect(page.getByText('PARTIALLY PAID', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reverse Payment', exact: true }).click();
    await page.getByLabel('Reversal Reason').fill('Correct entire remittance');
    await page.getByRole('button', { name: 'Confirm Reversal' }).click();
    await browserExpect(page.getByText('Reversed: Correct entire remittance', { exact: true })).toBeVisible();
    await browserExpect(page.getByText('UNPAID', { exact: true })).toBeVisible();
    const report = await getSupplierApOverview('org-a', '2026-10-05');
    expect(report.currencies[0]).toMatchObject({ outstanding_cents: '15000', paid_cents: '0' });
    expect(errors).toEqual([]); expect(serverErrors).toEqual([]);
    await page.close();
  });

  it('retains a single-bill retry key across a page reload without duplicating a partial payment', async () => {
    const page = await newPage();
    const start = submittedKeys.length;
    async function fill() {
      await page.getByRole('button', { name: 'Record Payment', exact: true }).first().click();
      await page.getByLabel('Amount').fill('25');
      await page.getByLabel('Payment Method').selectOption('CASH');
    }
    await page.goto(`${origin}/commercial/purchasing/supplier-bills/${bill1}`); await fill();
    loseNextPaymentResponse = true;
    await page.getByRole('button', { name: 'Record Payment', exact: true }).last().click();
    await browserExpect(page.getByText('Unable to confirm payment. Retry the same details or check payment history.')).toBeVisible();
    await page.reload(); await fill();
    await page.getByRole('button', { name: 'Record Payment', exact: true }).last().click();
    await browserExpect(page.getByLabel('Amount')).toHaveCount(0);
    expect(submittedKeys.slice(start)).toHaveLength(2); expect(submittedKeys[start]).toBe(submittedKeys[start + 1]);
    expect(await sql.raw("SELECT count(*)::int AS n FROM commercial_supplier_payments WHERE status='RECORDED'")).toEqual([{ n: 1 }]);
    expect((await getSupplierApOverview('org-a', '2026-10-05')).currencies[0].paid_cents).toBe('2500');
    // A confirmed subsequent submission with the same details is a new intent.
    await fill(); await page.getByRole('button', { name: 'Record Payment', exact: true }).last().click();
    await browserExpect(page.getByLabel('Amount')).toHaveCount(0);
    expect(submittedKeys[start + 2]).not.toBe(submittedKeys[start]);
    expect((await getSupplierApOverview('org-a', '2026-10-05')).currencies[0].paid_cents).toBe('5000');
    await page.close();
  });

  it('enforces the actual HTTP authorization composition and tenant boundaries', async () => {
    const url = `${origin}/api/commercial/suppliers/${supplierId}/payments`;
    try {
      role = 'viewer';
      expect((await fetch(url)).status).toBe(200);
      expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(403);
      role = 'admin'; entitled = false; expect((await fetch(url)).status).toBe(403);
      entitled = true; authenticated = false; expect((await fetch(url)).status).toBe(401);
      authenticated = true; organisationId = 'load-org'; expect((await fetch(url)).status).toBe(404);
    } finally { role = 'admin'; entitled = true; authenticated = true; organisationId = 'org-a'; }
    expect(serverErrors).toEqual([]);
  });

  it('measures paged overview/aging at 10,000 and 50,000 bills through the API and browser', async () => {
    await sql.raw(`INSERT INTO commercial_suppliers SELECT md5('supplier-'||n)::uuid,'load-org','Load supplier '||n,n%10<>0 FROM generate_series(1,1000) n`);
    async function seed(from: number, to: number) {
      await sql.raw(`INSERT INTO commercial_supplier_bills(id,organisation_id,supplier_id,currency,status,total_cents,subtotal_cents,bill_number,supplier_invoice_number,due_date)
        SELECT md5('bill-'||n)::uuid,'load-org',md5('supplier-'||(1+(n%1000)))::uuid,CASE WHEN n%3=0 THEN 'USD' ELSE 'AUD' END,'POSTED',10000,10000,'LOAD-'||n,'INV-'||n,
          CASE WHEN n%11=0 THEN NULL ELSE DATE '2026-10-05'-(n%150) END FROM generate_series(${from},${to}) n`);
      await sql.raw(`INSERT INTO commercial_supplier_payments(id,organisation_id,supplier_id,amount_cents,currency,method,paid_at,status,recorded_by,reversed_at,reversed_by,reversal_reason)
        SELECT md5('payment-'||n)::uuid,'load-org',md5('supplier-'||(1+(n%1000)))::uuid,2000,CASE WHEN n%3=0 THEN 'USD' ELSE 'AUD' END,'CASH',now(),
          CASE WHEN n%10=0 THEN 'REVERSED' ELSE 'RECORDED' END,'user-1',CASE WHEN n%10=0 THEN now() END,CASE WHEN n%10=0 THEN 'user-1' END,CASE WHEN n%10=0 THEN 'Load reversal' END
        FROM generate_series(${from},${to}) n WHERE n%2=0`);
      await sql.raw(`INSERT INTO commercial_supplier_payment_allocations(organisation_id,supplier_payment_id,supplier_bill_id,supplier_id,currency,allocated_amount_cents)
        SELECT 'load-org',md5('payment-'||n)::uuid,md5('bill-'||n)::uuid,md5('supplier-'||(1+(n%1000)))::uuid,CASE WHEN n%3=0 THEN 'USD' ELSE 'AUD' END,2000
        FROM generate_series(${from},${to}) n WHERE n%2=0`);
      await sql.raw('ANALYZE commercial_suppliers; ANALYZE commercial_supplier_bills; ANALYZE commercial_supplier_payments; ANALYZE commercial_supplier_payment_allocations');
    }
    const metrics: Array<Record<string, number>> = [];
    try {
      organisationId = 'load-org';
      for (const size of [10000, 50000]) {
        await seed(size === 10000 ? 1 : 10001, size);
        const times: number[] = []; let bytes = 0;
        for (let run = 0; run < 6; run++) {
          const started = performance.now();
          const response = await fetch(`${origin}/api/commercial/purchasing/ap-overview?aging_date=2026-10-05`);
          expect(response.status).toBe(200);
          const text = await response.text(); times.push(Math.round(performance.now() - started)); bytes = Buffer.byteLength(text);
          const report = JSON.parse(text).report;
          expect(report.bills).toHaveLength(50); expect(report.suppliers).toHaveLength(50);
          expect(report.pagination.outstanding_bill_count).toBe(size);
          expect(bytes).toBeLessThan(250000);
          expect(report.currencies.reduce((sum: bigint, row: { paid_cents: string }) => sum + BigInt(row.paid_cents), BigInt(0))).toBe(BigInt(size * 800));
          expect(report.currencies.reduce((sum: bigint, row: { outstanding_cents: string }) => sum + BigInt(row.outstanding_cents), BigInt(0))).toBe(BigInt(size * 9200));
        }
        const metric: Record<string, number> = { bills: size, suppliers: 1000, payments: size / 2, allocations: size / 2,
          first_ms: times[0], warm_max_ms: Math.max(...times.slice(1)), warm_median_ms: [...times.slice(1)].sort((a,b) => a-b)[2], json_bytes: bytes };
        {
          const page = await newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
          const started = performance.now(); await page.goto(`${origin}/overview`);
          await browserExpect(page.getByRole('link', { name: /^LOAD-/ })).toHaveCount(50, { timeout: 60000 });
          metric.browser_render_ms = Math.round(performance.now() - started);
          const firstLinks = await page.getByRole('link', { name: /^LOAD-/ }).allTextContents();
          const totals = await page.getByRole('table').first().textContent();
          await page.getByRole('button', { name: 'Next bill page', exact: true }).click();
          await browserExpect(page.getByRole('navigation', { name: 'bill pages', exact: true })).toContainText('Page 2');
          expect(await page.getByRole('link', { name: /^LOAD-/ }).allTextContents()).not.toEqual(firstLinks);
          expect(await page.getByRole('table').first().textContent()).toBe(totals);
          const searchStarted = performance.now(); await page.getByLabel('Search suppliers or bills').fill('LOAD-10000');
          await browserExpect(page.getByRole('link', { name: /^LOAD-/ })).toHaveCount(1, { timeout: 15000 });
          await browserExpect(page.getByRole('navigation', { name: 'bill pages', exact: true })).toContainText('Page 1');
          metric.browser_filter_ms = Math.round(performance.now() - searchStarted);
          expect(errors).toEqual([]); await page.close();
        }
        metrics.push(metric);
      }
      console.info('AP_LOAD_METRICS', JSON.stringify(metrics));
      mkdirSync('test-results', { recursive: true });
      writeFileSync('test-results/ap-readiness-load.json', JSON.stringify({ measured_at: new Date().toISOString(), metrics }, null, 2));
    } finally { organisationId = 'org-a'; }
    expect(serverErrors).toEqual([]);
  }, 120000);
});
