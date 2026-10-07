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
      name: 'supplier-remittance-browser-harness',
      enforce: 'pre',
      resolveId(id) {
        if (id.replaceAll('\\', '/').endsWith('/ap-browser-entry')) return '\0ap-browser-entry';
        if (['ap-browser-entry', 'next/navigation', 'next/link'].includes(id)) return `\0${id}`;
      },
      load(id) {
        if (id === '\0next/navigation') return "export const useParams = () => ({id:'00000000-0000-0000-0000-000000000101'}); export const useRouter = () => ({push(){}});";
        if (id === '\0next/link') return "import {createElement} from 'react'; export default function Link(props){return createElement('a',props)}";
        if (id === '\0ap-browser-entry') return `import {createElement} from 'react'; import {createRoot} from 'react-dom/client'; import Page from ${JSON.stringify(path.resolve('app/commercial/purchasing/suppliers/[id]/remittance/page.tsx').replaceAll('\\', '/'))}; createRoot(document.getElementById('root')).render(createElement(Page));`;
      },
    }],
    build: { write: false, lib: { entry: 'ap-browser-entry', name: 'APBrowser', formats: ['iife'] } },
  });
  const built = Array.isArray(result) ? result[0] : result;
  if (!('output' in built)) throw new Error('Expected a completed browser bundle, not watch mode');
  const output = built.output;
  bundle = output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
});

async function mount(page: Page, role = 'admin', conflict: boolean | 'network' = false) {
  const requests: Record<string, unknown>[] = [];
  let recorded = false;
  await page.route('http://localhost/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    let data: unknown = { role };
    if (url.pathname.endsWith('/payments')) {
      if (route.request().method() === 'POST') {
        requests.push(route.request().postDataJSON());
        if (conflict === 'network') return route.abort('failed');
        if (conflict) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Refresh balances before retrying.' }) });
        recorded = true;
        data = { payment: { id: 'p1', amount_cents: 7500, currency: 'AUD' }, allocations: [{ supplier_bill_id: 'b1', allocated_amount_cents: 2500 }, { supplier_bill_id: 'b2', allocated_amount_cents: 5000 }] };
      } else data = { supplier: { name: 'Supplier', active: true }, bills: recorded ? [] : [
        { bill_id: 'b1', bill_number: 'SB1', supplier_invoice_number: 'INV1', due_date: '2026-10-05', currency: 'AUD', outstanding_cents: '10000' },
        { bill_id: 'b2', bill_number: 'SB2', supplier_invoice_number: 'INV2', due_date: null, currency: 'AUD', outstanding_cents: '5000' },
        { bill_id: 'b3', bill_number: 'SB3', supplier_invoice_number: 'INV3', due_date: null, currency: 'USD', outstanding_cents: '5000' },
      ] };
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('http://localhost/'); await page.addScriptTag({ content: bundle });
  await expect(page.getByLabel('Currency')).toBeVisible();
  await page.getByLabel('Currency').selectOption('AUD');
  return requests;
}

test('records exact multi-bill allocations and shows all bill-history links', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const requests = await mount(page);
  await expect(page.getByText('Reversal from any allocated bill reverses the entire remittance.', { exact: false })).toBeVisible();
  await page.getByLabel('Allocate SB1').fill('25.00'); await page.getByLabel('Allocate SB2').fill('50.00');
  await page.getByLabel('Payment method').selectOption('BANK_TRANSFER');
  await page.getByRole('button', { name: 'Record Remittance' }).click();
  await expect(page.getByText('Payment recorded: $75.00', { exact: true })).toBeVisible();
  expect(requests).toEqual([{ currency: 'AUD', method: 'BANK_TRANSFER', reference: null, allocations: [{ supplier_bill_id: 'b1', amount_cents: 2500 }, { supplier_bill_id: 'b2', amount_cents: 5000 }] }]);
  await expect(page.getByRole('link', { name: 'View SB1 payment history' })).toHaveAttribute('href', '/commercial/purchasing/supplier-bills/b1');
  await expect(page.getByRole('link', { name: 'View SB2 payment history' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('switching currency clears allocations and invalid amounts block submission', async ({ page }) => {
  await mount(page);
  await page.getByLabel('Allocate SB1').fill('100.01');
  await expect(page.getByRole('alert')).toContainText('exceeds remaining');
  await expect(page.getByRole('button', { name: 'Record Remittance' })).toBeDisabled();
  await page.getByLabel('Currency').selectOption('USD');
  await expect(page.getByLabel('Allocate SB1')).toHaveCount(0);
  await page.getByLabel('Currency').selectOption('AUD');
  await expect(page.getByLabel('Allocate SB1')).toHaveValue('');
  await page.getByLabel('Allocate SB1').fill('1.001');
  await expect(page.getByRole('alert')).toContainText('two decimal places');
});
test('viewer cannot record a remittance', async ({ page }) => {
  await mount(page, 'viewer');
  await expect(page.getByLabel('Allocate SB1')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Record Remittance' })).toHaveCount(0);
});
test('balance conflict preserves editable allocations without a success claim', async ({ page }) => {
  await mount(page, 'admin', true);
  await page.getByLabel('Allocate SB1').fill('25'); await page.getByLabel('Payment method').selectOption('BANK_TRANSFER');
  await page.getByRole('button', { name: 'Record Remittance' }).click();
  await expect(page.getByRole('alert')).toContainText('Refresh balances');
  await expect(page.getByLabel('Allocate SB1')).toHaveValue('25');
  await expect(page.getByLabel('Allocate SB1')).toBeEnabled();
  await expect(page.getByText('Payment recorded:', { exact: false })).toHaveCount(0);
});
test('uncertain network failure advises checking history before retrying', async ({ page }) => {
  await mount(page, 'admin', 'network');
  await page.getByLabel('Allocate SB1').fill('25'); await page.getByLabel('Payment method').selectOption('BANK_TRANSFER');
  await page.getByRole('button', { name: 'Record Remittance' }).click();
  await expect(page.getByRole('alert')).toContainText('Check bill payment history before retrying');
  await expect(page.getByText('Payment recorded:', { exact: false })).toHaveCount(0);
});
