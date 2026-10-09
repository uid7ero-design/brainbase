import { test, expect } from '@playwright/test';
import { build } from 'vite';
import path from 'node:path';

const modes = ['lifecycle', 'tasks', 'documents'] as const;
const bundles = new Map<string, string>();
test.beforeAll(async () => {
  for (const mode of modes) {
    const file = mode === 'tasks' ? 'app/people/lifecycle/tasks/page.tsx' : `app/people/${mode}/page.tsx`;
    const result = await build({ configFile: false, logLevel: 'error', resolve: { alias: { '@': process.cwd() } },
      define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.env': '{}' }, oxc: { jsx: { runtime: 'automatic' } },
      plugins: [{ name: 'hr-register-browser-harness', enforce: 'pre', resolveId(id) {
        if (id.replaceAll('\\', '/').endsWith('/hr-browser-entry')) return '\0hr-browser-entry';
        if (id === 'hr-browser-entry' || id === 'next/link') return `\0${id}`;
        if (/\/_components\/PersonDrawer(?:\.tsx)?$/.test(id.replaceAll('\\', '/'))) return '\0drawer';
      }, load(id) {
        if (id === '\0next/link') return "import {createElement} from 'react'; export default function Link(props){return createElement('a',props)}";
        if (id === '\0drawer') return "import {createElement as h} from 'react'; export default function Drawer({personId,onClose}){return personId?h('div',{},h('span',{},'Selected '+personId),h('button',{onClick:onClose},'Close person')):null}";
        if (id === '\0hr-browser-entry') return `import {createElement} from 'react'; import {createRoot} from 'react-dom/client'; import Page from ${JSON.stringify(path.resolve(file).replaceAll('\\', '/'))}; createRoot(document.getElementById('root')).render(createElement(Page));`;
      } }], build: { write: false, lib: { entry: 'hr-browser-entry', name: 'HRBrowser', formats: ['iife'] } } });
    const built = Array.isArray(result) ? result[0] : result;
    if (!('output' in built)) throw new Error('Expected browser bundle');
    bundles.set(mode, built.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n'));
  }
});

for (const mode of modes) test(`${mode} search, filters, pages, drawer refresh and safe failure`, async ({ page }) => {
  const errors: string[] = [], methods: string[] = [];
  let fail = false, shrink = false;
  page.on('pageerror', error => errors.push(error.message));
  const people = Array.from({ length: 61 }, (_, i) => ({ id: `p-${i}`, first_name: `Worker ${String(i + 1).padStart(3, '0')}`, last_name: 'Fixture' }));
  const workflows = people.map((person, i) => ({ person_id: person.id, workflow_id: `w-${i}`, lifecycle_type: i % 2 ? 'offboarding' : 'onboarding', visible_tasks: 1, outstanding_tasks: 1, awaiting_approval: 0, overdue_tasks: 1 }));
  const tasks = workflows.map((workflow, i) => ({ ...workflow, task_id: `t-${i}`, title: `Task ${i + 1}`, status: 'NOT_STARTED', due_at: null, overdue: false }));
  const documents = people.map(person => ({ person_id: person.id, first_name: person.first_name, last_name: person.last_name, documents: 1, missing_version: 0, pending_acknowledgement: 1, unlinked_employee: 0, pending_verification: 1, rejected: 0, expired: 1, expiring_soon: 0 }));
  await page.route('http://brainbase.local/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    methods.push(route.request().method());
    if (fail) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"secret"}' });
    const rows = <T,>(values: T[]) => shrink ? values.slice(0, 1) : values;
    const body = url.pathname === '/api/hr/people' ? { people } : mode === 'tasks' ? { as_of: '2026-10-09T00:00:00Z', tasks: rows(tasks) }
      : mode === 'documents' ? { as_of_date: '2026-10-09', expiring_through: '2026-11-08', people: rows(documents) } : { workflows: rows(workflows) };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('http://brainbase.local/'); await page.addScriptTag({ content: bundles.get(mode)! });
  await expect(page.getByRole('button', { name: 'Worker 001 Fixture' })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(26);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Worker 026 Fixture' })).toBeVisible();
  const search = page.getByLabel(mode === 'tasks' ? 'Search people or tasks' : 'Search people', { exact: true });
  await search.fill('Worker 061');
  await expect(page.getByRole('status')).toContainText('Page 1 of 1');
  await page.getByRole('button', { name: 'Worker 061 Fixture' }).click();
  await expect(page.getByText('Selected p-60', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close person' }).click();
  await search.fill('');
  if (mode !== 'documents') {
    await page.getByRole('combobox', { name: /^Lifecycle/ }).selectOption('offboarding');
    await expect(page.getByRole('status')).toContainText('30 matching rows');
    await page.getByRole('combobox', { name: /^Lifecycle/ }).selectOption('all');
  }
  await expect(page.getByRole('navigation', { name: 'HR operational views' }).getByRole('link')).toHaveCount(4);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  shrink = true; await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Page 1 of 1');
  fail = true; await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText(/Unable to load .*Please refresh to try again/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Worker 001 Fixture' })).toHaveCount(0);
  await expect(page.getByText('secret', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]); expect(methods.every(method => method === 'GET')).toBe(true);
});
