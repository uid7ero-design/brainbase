import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import path from 'node:path';
import { buildSupplierApOverview } from '../../lib/commercial/supplierApOverviewModel';

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
      name: 'supplier-ap-overview-browser-harness',
      enforce: 'pre',
      resolveId(id) {
        if (id.replaceAll('\\', '/').endsWith('/ap-browser-entry')) return '\0ap-browser-entry';
        if (['ap-browser-entry', 'next/navigation', 'next/link'].includes(id)) return `\0${id}`;
      },
      load(id) {
        if (id === '\0next/navigation') return "export const useParams = () => ({id:'bill-1'}); export const useRouter = () => ({push(){}});";
        if (id === '\0next/link') return "import {createElement} from 'react'; export default function Link(props){return createElement('a',props)}";
        if (id === '\0ap-browser-entry') return `import {createElement} from 'react'; import {createRoot} from 'react-dom/client'; import Page from ${JSON.stringify(path.resolve('app/commercial/purchasing/ap-overview/page.tsx').replaceAll('\\', '/'))}; createRoot(document.getElementById('root')).render(createElement(Page));`;
      },
    }],
    build: { write: false, lib: { entry: 'ap-browser-entry', name: 'APBrowser', formats: ['iife'] } },
  });
  const built = Array.isArray(result) ? result[0] : result;
  if (!('output' in built)) throw new Error('Expected a completed browser bundle, not watch mode');
  const output = built.output;
  bundle = output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
});

async function mount(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const dates: string[] = [];
  await page.route('http://brainbase.local/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    const date = url.searchParams.get('aging_date') ?? '';
    dates.push(date);
    if (date === '2026-10-07') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Forbidden' }) });
    if (!date) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Choose a date' }) });
    const rows = [
      { supplier_id: 's1', supplier_name: 'Inactive supplier', supplier_active: false, bill_id: 'b1', bill_number: 'SB1', supplier_invoice_number: 'INV1', due_date: '2026-09-05', currency: 'AUD', payable_cents: '10000', paid_cents: '2500' },
      { supplier_id: 's2', supplier_name: 'USD supplier', supplier_active: true, bill_id: 'b2', bill_number: 'SB2', supplier_invoice_number: 'INV2', due_date: null, currency: 'USD', payable_cents: '20000', paid_cents: '0' },
    ];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ report: buildSupplierApOverview(rows, date) }) });
  });
  await page.goto('http://brainbase.local/');
  await page.addScriptTag({ content: bundle });
  await page.getByLabel('Aging date').fill('2026-10-05');
  await expect(page.getByRole('link', { name: 'SB1', exact: true })).toBeVisible();
  return { dates, errors };
}

test('shows currency-separated filtered totals, inactive supplier aging, and bill links', async ({ page }) => {
  const { errors } = await mount(page);
  const totals = page.getByRole('table').first();
  await expect(totals.getByRole('row')).toHaveCount(3);
  await expect(page.getByText('Inactive supplier (Inactive)', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'SB1', exact: true })).toHaveAttribute('href', '/commercial/purchasing/supplier-bills/b1');
  await page.getByLabel('Currency', { exact: true }).selectOption('AUD');
  await expect(totals.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'SB2', exact: true })).toHaveCount(0);
  await expect(totals).toContainText('$75.00');
  await page.getByLabel('Aging bucket').selectOption('NO_DUE_DATE');
  await expect(page.getByText('No posted bills match these filters.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('changes aging classification and clears previous balances on a forbidden read', async ({ page }) => {
  const { dates, errors } = await mount(page);
  const outstanding = page.getByRole('table').last();
  await expect(outstanding).toContainText('1–30 days overdue');
  await page.getByLabel('Aging date').fill('2026-10-06');
  await expect(outstanding).toContainText('31–60 days overdue');
  await page.getByLabel('Aging date').fill('2026-10-07');
  await expect(page.getByRole('alert')).toContainText('You do not have access');
  await expect(page.getByRole('table')).toHaveCount(0);
  expect(dates).toContain('2026-10-06'); expect(errors).toEqual([]);
});
