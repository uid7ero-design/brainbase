import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import path from 'node:path';

// Exercise the real client component; only navigation and HTTP are test seams.
let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'error',
    resolve: { alias: { '@': process.cwd() } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.env': '{}' },
    oxc: { jsx: { runtime: 'automatic' } },
    plugins: [{
      name: 'supplier-payment-browser-harness',
      enforce: 'pre',
      resolveId(id) {
        if (id.replaceAll('\\', '/').endsWith('/ap-browser-entry')) return '\0ap-browser-entry';
        if (['ap-browser-entry', 'next/navigation', 'next/link'].includes(id)) return `\0${id}`;
      },
      load(id) {
        if (id === '\0next/navigation') return "export const useParams = () => ({id:'bill-1'}); export const useRouter = () => ({push(){}});";
        if (id === '\0next/link') return "import {createElement} from 'react'; export default function Link(props){return createElement('a',props)}";
        if (id === '\0ap-browser-entry') return `import {createElement} from 'react'; import {createRoot} from 'react-dom/client'; import Page from ${JSON.stringify(path.resolve('app/commercial/purchasing/supplier-bills/[id]/page.tsx').replaceAll('\\', '/'))}; createRoot(document.getElementById('root')).render(createElement(Page));`;
      },
    }],
    build: { write: false, lib: { entry: 'ap-browser-entry', name: 'APBrowser', formats: ['iife'] } },
  });
  const built = Array.isArray(result) ? result[0] : result;
  if (!('output' in built)) throw new Error('Expected a completed browser bundle, not watch mode');
  const output = built.output;
  bundle = output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
});

async function mount(page: Page, role = 'admin', draft = false) {
  let billStatus = draft ? 'DRAFT' : 'POSTED';
  const billTotal = draft ? 12000 : 10000;
  const payments: Array<Record<string, unknown>> = [];
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const summary = () => {
    const active = payments.filter(p => p.status === 'RECORDED');
    const paid = active.reduce((sum, p) => sum + Number(p.allocated_amount_cents), 0);
    const payable = billStatus === 'DRAFT' ? 0 : billTotal;
    return { supplier_bill_id: 'bill-1', total_cents: payable, amount_paid_cents: paid,
      outstanding_balance_cents: payable - paid, active_payment_count: active.length,
      payment_state: paid === billTotal ? 'PAID' : paid ? 'PARTIALLY_PAID' : 'UNPAID', payments };
  };
  await page.route('http://localhost/**', async route => {
    const url = new URL(route.request().url());
    let data: unknown = {};
    if (url.pathname.endsWith('/post')) {
      billStatus = 'POSTED';
      data = { supplierBill: { id: 'bill-1', status: billStatus } };
    } else if (url.pathname.endsWith('/payments') || url.pathname.endsWith('/reverse')) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        requests.push({ url: url.pathname, body });
        if (url.pathname.endsWith('/reverse')) {
          Object.assign(payments[0], { status: 'REVERSED', reversal_reason: body.reason });
        } else {
          payments.push({ id: 'payment-1', amount_cents: body.amount_cents, allocated_amount_cents: body.amount_cents,
            currency: 'AUD', method: body.method, reference: body.reference, paid_at: body.paid_at ?? '2026-10-05T00:00:00Z', status: 'RECORDED' });
        }
      }
      data = { supplier_bill_payment_summary: summary() };
    } else if (url.pathname === '/api/me') data = { role };
    else if (url.pathname.endsWith('/attachments')) data = { attachments: [] };
    else if (url.pathname.endsWith('/tax-codes')) data = { taxCodes: [] };
    else if (url.pathname.endsWith('/bill-1')) data = {
      supplierBill: { id: 'bill-1', source_purchase_order_id: 'po-1', supplier_invoice_number: 'INV-1', bill_number: 'SB-1',
        status: billStatus, currency: 'AUD', total_cents: billTotal, subtotal_cents: billTotal, tax_cents: 0, created_at: '2026-10-05T00:00:00Z' },
      lines: draft ? [{ id: 'line-1', source_purchase_order_line_id: 'po-line-1', description: 'Review supplies', quantity: '2', unit_price_cents: 6000, tax_cents: 0, line_total_cents: 12000 }] : [],
      purchaseOrder: { id: 'po-1', purchase_order_number: 'PO-1', supplier_name_snapshot: 'Test supplier' },
      purchaseOrderLines: [], billedAmounts: {},
    };
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('http://localhost/');
  await page.addScriptTag({ content: bundle });
  if (draft) await expect(page.getByRole('button', { name: 'Post Bill', exact: true })).toBeVisible();
  else await expect(page.getByRole('heading', { name: 'Supplier Payments', exact: true })).toBeVisible();
  return requests;
}

test('records a partial payment, blocks cancellation, then reverses with preserved history', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const requests = await mount(page);
  await page.getByRole('button', { name: 'Record Payment', exact: true }).click();
  await page.getByLabel('Amount').fill('25.00');
  await page.getByLabel('Payment Method').selectOption('BANK_TRANSFER');
  await page.getByLabel('Reference', { exact: true }).fill('AP browser');
  await page.getByRole('button', { name: 'Record Payment', exact: true }).last().click();
  await expect(page.getByText('PARTIALLY PAID', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel Bill', exact: true })).toBeDisabled();
  expect(requests[0].body).toEqual({ amount_cents: 2500, method: 'BANK_TRANSFER', reference: 'AP browser', paid_at: null });
  await page.getByRole('button', { name: 'Reverse Payment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm Reversal' })).toBeDisabled();
  await page.getByLabel('Reversal Reason').fill('Incorrect remittance');
  await page.getByRole('button', { name: 'Confirm Reversal' }).click();
  await expect(page.getByText('Reversed: Incorrect remittance', { exact: true })).toBeVisible();
  await expect(page.getByText('UNPAID', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel Bill', exact: true })).toBeEnabled();
  expect(requests[1].url).toBe('/api/commercial/supplier-bills/bill-1/payments/payment-1/reverse');
  expect(errors).toEqual([]);
});

test('posting a draft refreshes its payable balance and permits payment without a page reload', async ({ page }) => {
  await mount(page, 'admin', true);
  await page.getByRole('button', { name: 'Post Bill', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, Post Bill', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Supplier Payments', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Record Payment', exact: true }).click();
  await page.getByLabel('Amount').fill('120.00');
  await page.getByLabel('Payment Method').selectOption('BANK_TRANSFER');
  await page.getByRole('button', { name: 'Record Payment', exact: true }).last().click();
  await expect(page.getByText('PAID', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record Payment', exact: true })).toHaveCount(0);
});

test('viewer sees payment summary without payment mutation actions', async ({ page }) => {
  await mount(page, 'viewer');
  await expect(page.getByText('No supplier payments recorded.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record Payment', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reverse Payment', exact: true })).toHaveCount(0);
});
