import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { NextRequest, NextResponse } from 'next/server';
import { createServer } from 'node:http';
import { chromium, expect as browserExpect } from '@playwright/test';
import { build } from 'vite';
import path from 'node:path';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)) throw new Error('Document proof requires disposable loopback Postgres.');
const pool = new Pool({ connectionString: databaseUrl });
type Query = { text: string; values: unknown[] };
const query = (strings: TemplateStringsArray, ...values: unknown[]): Query => ({
  text: strings.reduce((result, part, index) => result + (index ? `$${index}` : '') + part, ''), values,
});
vi.doMock('@/lib/db', () => ({ default: Object.assign(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const spec = query(strings, ...values); return (await pool.query(spec.text, spec.values)).rows;
}, { transaction: async (build: (txn: typeof query) => Query[]) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); const results = [];
    for (const spec of build(query)) results.push((await client.query(spec.text, spec.values)).rows);
    await client.query('COMMIT'); return results;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
} }) }));
const blobs = new Map<string, Uint8Array>();
vi.doMock('@/lib/hr/employeeDocumentStorage', async () => ({
  ...await vi.importActual<typeof import('@/lib/hr/employeeDocumentStorage')>('@/lib/hr/employeeDocumentStorage'),
  createEmployeeHrDocumentStore: () => ({
    put: async (key: string, bytes: Uint8Array) => { blobs.set(key, bytes.slice()); },
    delete: async (key: string) => { blobs.delete(key); },
  }),
}));
const org = 'document-mutation-proof';
const personId = '94444444-4444-4444-8444-444444444444';
const hr = { organisationId: org, userId: 'document-hr', isSuperAdmin: false };
const employee = { organisationId: org, userId: 'document-employee', isSuperAdmin: false };
const outsider = { organisationId: org, userId: 'document-outsider', isSuperAdmin: false };
let routeUser = hr.userId;
let authenticated = true;
vi.doMock('@/lib/org', () => ({
  requireSession: async () => { if (!authenticated) throw new Error('Unauthenticated'); return { organisationId: org, userId: routeUser, role: 'viewer' }; },
  unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  forbidden: () => NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.doMock('@/lib/hr/capability', () => ({ requireHrCapability: async () => {} }));
let routes: typeof import('@/app/api/hr/people/[id]/documents/route');
let versions: typeof import('@/app/api/hr/people/[id]/documents/[documentId]/versions/route');
let remove: typeof import('@/app/api/hr/people/[id]/documents/[documentId]/route');
let acknowledge: typeof import('@/app/api/hr/people/[id]/documents/[documentId]/versions/[versionId]/acknowledgements/route');
let verify: typeof import('@/app/api/hr/people/[id]/documents/[documentId]/versions/[versionId]/verifications/route');
const routeParams = (documentId = '', versionId = '') => ({ params: Promise.resolve({ id: personId, documentId, versionId }) });
const routeRequest = (method: string, body?: FormData | Record<string, unknown>) => new NextRequest('http://fixture.local/api/hr/documents', {
  method, ...(body instanceof FormData ? { body } : body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
});
const multipart = (create = false) => {
  const form = new FormData(); form.set('file', new File(['Synthetic fixture'], 'synthetic.txt', { type: 'text/plain' }));
  if (create) { form.set('document_type', 'policy'); form.set('title', 'HTTP policy'); } return form;
};
let documents: typeof import('@/lib/hr/employeeDocumentMutations');
let assurance: typeof import('@/lib/hr/employeeDocumentAssuranceMutations');
const q = async (text: string, values: unknown[] = []) => (await pool.query(text, values)).rows;
const upload = { originalFilename: 'synthetic.txt', contentType: 'text/plain', bytes: new Uint8Array([65]), expiresAt: null };
async function create() {
  const result = await documents.createEmployeeDocumentWithVersion({ actor: hr, personId, documentType: 'policy', title: 'Synthetic policy', lifecycleTaskId: null, ...upload });
  if (result.outcome !== 'created') throw new Error(`Expected create, got ${result.outcome}`);
  return result;
}
const snapshot = async () => ({
  documents: await q('SELECT * FROM hr_employee_documents WHERE organisation_id=$1 ORDER BY id', [org]),
  versions: await q('SELECT * FROM hr_employee_document_versions WHERE organisation_id=$1 ORDER BY id', [org]),
  acknowledgements: await q('SELECT * FROM hr_employee_document_acknowledgements WHERE organisation_id=$1 ORDER BY id', [org]),
  verifications: await q('SELECT * FROM hr_employee_document_verifications WHERE organisation_id=$1 ORDER BY id', [org]),
  audits: await q('SELECT * FROM audit_logs WHERE organisation_id=$1 ORDER BY id', [org]),
});
beforeAll(async () => {
  await q(readFileSync('scripts/create-hr-employee-documents.sql', 'utf8'));
  await q(readFileSync('scripts/create-hr-employee-document-assurance.sql', 'utf8'));
  documents = await import('@/lib/hr/employeeDocumentMutations'); assurance = await import('@/lib/hr/employeeDocumentAssuranceMutations');
  routes = await import('@/app/api/hr/people/[id]/documents/route');
  versions = await import('@/app/api/hr/people/[id]/documents/[documentId]/versions/route');
  remove = await import('@/app/api/hr/people/[id]/documents/[documentId]/route');
  acknowledge = await import('@/app/api/hr/people/[id]/documents/[documentId]/versions/[versionId]/acknowledgements/route');
  verify = await import('@/app/api/hr/people/[id]/documents/[documentId]/versions/[versionId]/verifications/route');
  await q('INSERT INTO organisations(id,name,slug) VALUES ($1,$1,$1)', [org]);
  for (const userId of [hr.userId, employee.userId, outsider.userId]) {
    await q('INSERT INTO users(id,organisation_id,username,name) VALUES ($1,$2,$1,$1)', [userId, org]);
  }
  await q('INSERT INTO hr_people(id,organisation_id,linked_user_id,first_name,last_name) VALUES ($1,$2,$3,$4,$5)', [personId, org, employee.userId, 'Synthetic', 'Employee']);
});
beforeEach(async () => {
  blobs.clear();
  routeUser = hr.userId; authenticated = true;
  for (const table of ['hr_employee_document_acknowledgements', 'hr_employee_document_verifications', 'hr_employee_document_versions', 'hr_employee_documents', 'audit_logs', 'hr_administrators']) {
    await q(`DELETE FROM ${table} WHERE organisation_id=$1`, [org]);
  }
  await q('INSERT INTO hr_administrators(organisation_id,user_id) VALUES ($1,$2)', [org, hr.userId]);
  for (const table of ['hr_lifecycle_task_approvals', 'hr_lifecycle_tasks', 'hr_lifecycle_workflows']) {
    await q(`DELETE FROM ${table} WHERE organisation_id=$1`, [org]);
  }
});
afterAll(async () => { await pool.end(); });
describe('Employee document mutations against Postgres with in-memory storage', () => {
  it.each(['cancel', 'approval'] as const)('proves lifecycle %s routes with current database authority in the shared fixture', async scenario => {
    const workflows = await import('@/app/api/hr/lifecycle/workflows/route');
    const cancel = await import('@/app/api/hr/lifecycle/workflows/[id]/cancel/route');
    const templateId = scenario === 'cancel' ? '95555555-5555-4555-8555-555555555555' : '95555555-5555-4555-8555-555555555556';
    await q(`INSERT INTO hr_lifecycle_templates(id,organisation_id,template_key,version_number,lifecycle_type,name,status,activated_at,created_by)
      VALUES($1,$2,$4,1,'onboarding','Route proof','ACTIVE',now(),$3)`, [templateId, org, hr.userId, `route-proof-${scenario}`]);
    await q(`INSERT INTO hr_lifecycle_template_tasks(organisation_id,template_id,sequence,title,responsibility_type,due_offset_days,requires_approval,approval_type,employee_visible,manager_visible,internal_only)
      VALUES($1,$2,1,'Employee route task','EMPLOYEE',0,$3,$4,true,false,false)`, [org, templateId, scenario === 'approval', scenario === 'approval' ? 'HR_ADMIN' : 'NONE']);
    const request = new NextRequest('http://fixture.local/api/hr/lifecycle/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person_id: personId, template_id: templateId, anchor_date: '2026-10-12' }) });
    authenticated = false; expect((await workflows.POST(request.clone() as NextRequest)).status).toBe(401); authenticated = true;
    const started = await workflows.POST(request); expect(started.status).toBe(201); const result = await started.json();
    expect(result.tasks).toHaveLength(1);
    const read = () => workflows.GET(new NextRequest(`http://fixture.local/api/hr/lifecycle/workflows?person_id=${personId}`));
    expect((await (await read()).json()).capabilities.can_start_workflow).toBe(true);
    if (scenario === 'approval') {
      const tasks = await import('@/app/api/hr/lifecycle/tasks/[id]/route');
      const approvals = await import('@/app/api/hr/lifecycle/tasks/[id]/approvals/route');
      const taskParams = { params: Promise.resolve({ id: result.tasks[0].id }) };
      routeUser = employee.userId;
      expect((await tasks.PATCH(routeRequest('PATCH', { action: 'start' }), taskParams)).status).toBe(200);
      expect((await tasks.PATCH(routeRequest('PATCH', { action: 'complete' }), taskParams)).status).toBe(200);
      expect((await approvals.POST(routeRequest('POST', { decision: 'APPROVED' }), taskParams)).status).toBe(403);
      routeUser = hr.userId;
      expect((await approvals.POST(routeRequest('POST', { decision: 'REJECTED' }), taskParams)).status).toBe(201);
      routeUser = employee.userId;
      expect((await tasks.PATCH(routeRequest('PATCH', { action: 'complete' }), taskParams)).status).toBe(200);
      routeUser = hr.userId;
      expect((await approvals.POST(routeRequest('POST', { decision: 'APPROVED' }), taskParams)).status).toBe(201);
      expect((await q('SELECT decision FROM hr_lifecycle_task_approvals WHERE task_id=$1 ORDER BY decision', [result.tasks[0].id])).map(row => row.decision)).toEqual(['APPROVED', 'REJECTED']);
      const listed = await (await read()).json(); expect(listed.workflows[0].status).toBe('COMPLETED'); expect(listed.workflows[0].capabilities.can_cancel).toBe(false); return;
    }
    const params = { params: Promise.resolve({ id: result.workflow.id }) };
    await q('DELETE FROM hr_administrators WHERE organisation_id=$1', [org]);
    expect((await cancel.POST(routeRequest('POST'), params)).status).toBe(403);
    expect((await q('SELECT status FROM hr_lifecycle_workflows WHERE id=$1', [result.workflow.id]))[0].status).toBe('ACTIVE');
    await q('INSERT INTO hr_administrators(organisation_id,user_id) VALUES($1,$2)', [org, hr.userId]);
    expect((await cancel.POST(routeRequest('POST'), params)).status).toBe(200);
    const listed = await (await read()).json(); expect(listed.workflows[0].status).toBe('CANCELLED'); expect(listed.workflows[0].capabilities.can_cancel).toBe(false);
  });
  it.each(['success', 'revoked', 'lost-response', 'lost-version', 'lost-delete', 'lost-verification', 'lost-acknowledgement', 'lifecycle', 'lifecycle-approval', 'lifecycle-revoked', 'lifecycle-lost', 'lifecycle-lost-task', 'lifecycle-lost-start', 'lifecycle-lost-cancel'] as const)('real drawer document writes: %s', async scenario => {
    const workflowRoutes = await import('@/app/api/hr/lifecycle/workflows/route');
    const workflowDetail = await import('@/app/api/hr/lifecycle/workflows/[id]/route');
    const workflowCancel = await import('@/app/api/hr/lifecycle/workflows/[id]/cancel/route');
    const templateRoutes = await import('@/app/api/hr/lifecycle/templates/route');
    const taskRoutes = await import('@/app/api/hr/lifecycle/tasks/[id]/route');
    const taskApprovals = await import('@/app/api/hr/lifecycle/tasks/[id]/approvals/route');
    const status = await import('@/app/api/hr/people/[id]/documents/[documentId]/versions/[versionId]/assurance/route');
    const built = await build({ configFile: false, logLevel: 'error', resolve: { alias: { '@': process.cwd() } },
      define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.env': '{}' }, oxc: { jsx: { runtime: 'automatic', development: false } },
      plugins: [{ name: 'document-browser-proof', resolveId(id) {
        if (id === 'document-entry' || id.replaceAll('\\', '/').endsWith('/document-entry')) return '\0document-entry';
      }, load(id) {
        if (id === '\0document-entry') return `import {createElement} from 'react'; import {createRoot} from 'react-dom/client'; import Drawer from ${JSON.stringify(path.resolve('app/people/_components/PersonDrawer.tsx').replaceAll('\\', '/'))}; createRoot(document.getElementById('root')).render(createElement(Drawer,{personId:${JSON.stringify(personId)},canManage:false,onClose:()=>{},onEdit:()=>{}}));`;
      } }], build: { write: false, lib: { entry: 'document-entry', name: 'DocumentProof', formats: ['iife'] } } });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Expected browser bundle');
    const script = output.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
    const errors: string[] = [], writes: string[] = [];
    const server = createServer((incoming, outgoing) => { void (async () => {
      if (incoming.url === '/') { outgoing.writeHead(200, { 'Content-Type': 'text/html' }); outgoing.end('<div id="root"></div>'); return; }
      const url = new URL(incoming.url!, 'http://fixture.local'), segments = url.pathname.split('/');
      const parts: Uint8Array[] = []; for await (const chunk of incoming) parts.push(chunk);
      const body = Buffer.concat(parts);
      const req = new NextRequest(url, { method: incoming.method, headers: { 'Content-Type': incoming.headers['content-type'] || 'application/json' }, ...(body.length ? { body } : {}) });
      let result: Response;
      if (url.pathname.startsWith('/api/hr/lifecycle/') && scenario.startsWith('lifecycle')) {
        if (incoming.method !== 'GET') writes.push(incoming.method!);
        const params = { params: Promise.resolve({ id: segments[5] }) };
        result = segments[4] === 'tasks' ? (segments[6] === 'approvals' ? await taskApprovals.POST(req, params) : await taskRoutes.PATCH(req, params))
          : segments[4] === 'templates' ? await templateRoutes.GET(req)
          : segments.length === 5 ? (incoming.method === 'GET' ? await workflowRoutes.GET(req) : await workflowRoutes.POST(req))
          : segments[6] === 'cancel' ? await workflowCancel.POST(req, params) : await workflowDetail.GET(req, params);
      } else if (url.pathname.startsWith('/api/hr/lifecycle/')) result = NextResponse.json({ workflows: [], capabilities: { can_start_workflow: false } });
      else if (segments.length === 5) result = NextResponse.json({ person: { id: personId, first_name: 'Synthetic', last_name: 'Employee', job_title: null, employment_status: 'active', worker_type: 'employee' } });
      else {
        const params = routeParams(segments[6], segments[8]);
        if (incoming.method !== 'GET') writes.push(incoming.method!);
        if (segments.length === 6) result = incoming.method === 'GET' ? await routes.GET(req, params) : await routes.POST(req, params);
        else if (segments.length === 7) result = await remove.DELETE(req, params);
        else if (segments.length === 8) result = incoming.method === 'GET' ? await versions.GET(req, params) : await versions.POST(req, params);
        else if (segments[9] === 'acknowledgements') result = await acknowledge.POST(req, params);
        else if (segments[9] === 'verifications') result = await verify.POST(req, params);
        else result = await status.GET(req, params);
      }
      outgoing.writeHead(result.status, { 'Content-Type': 'application/json' }); outgoing.end(await result.text());
    })().catch(error => { errors.push(String(error)); outgoing.destroy(error); }); });
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected loopback listener');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}/`); await page.addScriptTag({ content: script });
      if (scenario.startsWith('lifecycle')) {
        await page.getByRole('button', { name: 'Start workflow', exact: true }).click();
        await page.getByRole('combobox', { name: /^Template/ }).selectOption(scenario === 'lifecycle' ? '95555555-5555-4555-8555-555555555555' : '95555555-5555-4555-8555-555555555556', { timeout: 5000 }).catch(async error => {
          throw new Error(`${String(error)}; errors: ${JSON.stringify(errors)}; rendered: ${await page.locator('body').innerText()}`);
        });
        await page.getByLabel('Anchor date', { exact: true }).fill('2026-10-12');
        if (scenario === 'lifecycle-lost-start') {
          await page.route('**/workflows', async route => {
            if (route.request().method() === 'GET') return route.continue();
            const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed');
          });
        }
        await page.getByRole('button', { name: 'Start', exact: true }).click();
        if (scenario === 'lifecycle-lost-start') {
          await browserExpect(page.getByText(/Workflow start outcome is unknown/)).toBeVisible();
          await browserExpect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
          await browserExpect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
          const saved = await q('SELECT * FROM hr_lifecycle_workflows WHERE organisation_id=$1', [org]), audits = (await snapshot()).audits;
          expect(saved).toHaveLength(1); expect(saved[0].status).toBe('ACTIVE'); expect(writes).toEqual(['POST']);
          await page.reload(); await page.addScriptTag({ content: script });
          await browserExpect(page.getByRole('button', { name: 'Cancel workflow', exact: true })).toBeVisible();
          expect(await q('SELECT * FROM hr_lifecycle_workflows WHERE organisation_id=$1', [org])).toEqual(saved);
          expect((await snapshot()).audits).toEqual(audits); expect(writes).toEqual(['POST']); expect(errors).toEqual([]); return;
        }
        await browserExpect(page.getByRole('button', { name: 'Cancel workflow', exact: true })).toBeVisible();
        const active = await q("SELECT id FROM hr_lifecycle_workflows WHERE organisation_id=$1 AND status='ACTIVE'", [org]); expect(active).toHaveLength(1);
        if (scenario !== 'lifecycle' && scenario !== 'lifecycle-lost-cancel') {
          const task = (await q('SELECT id FROM hr_lifecycle_tasks WHERE workflow_id=$1', [active[0].id]))[0];
          routeUser = employee.userId; await page.reload(); await page.addScriptTag({ content: script });
          await page.getByRole('button', { name: 'View tasks', exact: true }).first().click();
          await page.getByRole('button', { name: 'Start task', exact: true }).click();
          if (scenario === 'lifecycle-lost-task') {
            await page.route('**/tasks/*', async route => {
              if (route.request().method() !== 'PATCH' || route.request().postDataJSON().action !== 'complete') return route.continue();
              const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
            });
          }
          await page.getByRole('button', { name: 'Complete task', exact: true }).click();
          await browserExpect.poll(async () => (await q('SELECT status FROM hr_lifecycle_tasks WHERE id=$1', [task.id]))[0].status).toBe('AWAITING_APPROVAL');
          if (scenario === 'lifecycle-lost-task') {
            await browserExpect(page.getByText(/Task outcome is unknown/)).toBeVisible();
            await browserExpect(page.getByRole('button', { name: 'Complete task', exact: true })).toBeDisabled();
            await page.getByRole('button', { name: 'Hide tasks', exact: true }).click();
            await page.getByRole('button', { name: 'View tasks', exact: true }).first().click();
            await browserExpect(page.getByRole('button', { name: 'Complete task', exact: true })).toBeDisabled();
            const saved = await q('SELECT * FROM hr_lifecycle_tasks WHERE id=$1', [task.id]), audits = (await snapshot()).audits, attempts = [...writes];
            await page.reload(); await page.addScriptTag({ content: script });
            await page.getByRole('button', { name: 'View tasks', exact: true }).first().click();
            await browserExpect(page.getByText('Employee route task · AWAITING_APPROVAL', { exact: true })).toBeVisible();
            await browserExpect(page.getByRole('button', { name: 'Complete task', exact: true })).toHaveCount(0);
            expect(await q('SELECT * FROM hr_lifecycle_tasks WHERE id=$1', [task.id])).toEqual(saved); expect((await snapshot()).audits).toEqual(audits);
            expect(writes).toEqual(attempts); expect(errors).toEqual([]); return;
          }
          await browserExpect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
          routeUser = hr.userId; await page.reload(); await page.addScriptTag({ content: script });
          await page.getByRole('button', { name: 'View tasks', exact: true }).first().click();
          if (scenario === 'lifecycle-revoked') {
            await browserExpect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
            await q('DELETE FROM hr_administrators WHERE organisation_id=$1', [org]);
            const lifeSnapshot = async () => ({
              workflow: await q('SELECT * FROM hr_lifecycle_workflows WHERE id=$1', [active[0].id]),
              task: await q('SELECT * FROM hr_lifecycle_tasks WHERE id=$1', [task.id]),
              approvals: await q('SELECT * FROM hr_lifecycle_task_approvals WHERE task_id=$1 ORDER BY id', [task.id]),
              audit: (await snapshot()).audits,
            });
            const before = await lifeSnapshot(); const attempts = writes.length;
            const denied = page.waitForResponse(response => response.url().endsWith('/approvals'));
            await page.getByRole('button', { name: 'Approve', exact: true }).click();
            expect((await denied).status()).toBe(404);
            await browserExpect(page.getByText('Could not record lifecycle task approval.', { exact: true })).toBeVisible();
            expect(await lifeSnapshot()).toEqual(before); expect(writes).toHaveLength(attempts + 1);
            await page.reload(); const read = page.waitForResponse(response => response.url().includes('/workflows?'));
            await page.addScriptTag({ content: script }); await read;
            await browserExpect(page.getByText('Synthetic Employee', { exact: true })).toBeVisible();
            await browserExpect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
            expect(await lifeSnapshot()).toEqual(before); expect(writes).toHaveLength(attempts + 1); expect(errors).toEqual([]); return;
          }
          await page.getByRole('button', { name: 'Reject', exact: true }).click();
          await browserExpect.poll(async () => (await q('SELECT count(*)::int AS count FROM hr_lifecycle_task_approvals WHERE task_id=$1', [task.id]))[0].count).toBe(1);
          routeUser = employee.userId; await page.reload(); await page.addScriptTag({ content: script });
          await page.getByRole('button', { name: 'View tasks', exact: true }).first().click();
          await page.getByRole('button', { name: 'Complete task', exact: true }).click();
          await browserExpect.poll(async () => (await q('SELECT status FROM hr_lifecycle_tasks WHERE id=$1', [task.id]))[0].status).toBe('AWAITING_APPROVAL');
          routeUser = hr.userId; await page.reload(); await page.addScriptTag({ content: script });
          await page.getByRole('button', { name: 'View tasks', exact: true }).first().click();
          if (scenario === 'lifecycle-lost') {
            await page.route('**/approvals', async route => { const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed'); });
          }
          await page.getByRole('button', { name: 'Approve', exact: true }).click();
          await browserExpect.poll(async () => (await q('SELECT status FROM hr_lifecycle_workflows WHERE id=$1', [active[0].id]))[0].status).toBe('COMPLETED');
          expect((await q('SELECT decision FROM hr_lifecycle_task_approvals WHERE task_id=$1 ORDER BY decision', [task.id])).map(row => row.decision)).toEqual(['APPROVED', 'REJECTED']);
          if (scenario === 'lifecycle-lost') {
            await browserExpect(page.getByText(/Approval outcome is unknown/)).toBeVisible();
            await browserExpect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
            await browserExpect(page.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
            await page.getByRole('button', { name: 'Hide tasks', exact: true }).click();
            await page.getByRole('button', { name: 'View tasks', exact: true }).first().click();
            await browserExpect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
            await browserExpect(page.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
            const committed = {
              approvals: await q('SELECT * FROM hr_lifecycle_task_approvals WHERE task_id=$1 ORDER BY id', [task.id]),
              audits: (await snapshot()).audits,
            };
            const attempts = [...writes]; await page.reload(); await page.addScriptTag({ content: script });
            await page.getByRole('button', { name: 'View tasks', exact: true }).first().click();
            await browserExpect(page.getByText('Employee route task · COMPLETED', { exact: true }).first()).toBeVisible();
            expect(await q('SELECT * FROM hr_lifecycle_task_approvals WHERE task_id=$1 ORDER BY id', [task.id])).toEqual(committed.approvals);
            expect((await snapshot()).audits).toEqual(committed.audits); expect(writes).toEqual(attempts);
          }
          await browserExpect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
          expect(writes).toEqual(['POST', 'PATCH', 'PATCH', 'POST', 'PATCH', 'POST']); expect(errors).toEqual([]); return;
        }
        if (scenario === 'lifecycle-lost-cancel') {
          await page.route('**/cancel', async route => { const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); });
        }
        await page.getByRole('button', { name: 'Cancel workflow', exact: true }).click();
        await page.getByRole('button', { name: 'Confirm cancel', exact: true }).click();
        if (scenario === 'lifecycle-lost-cancel') {
          await browserExpect(page.getByText(/Workflow cancellation outcome is unknown/)).toBeVisible();
          await browserExpect(page.getByRole('button', { name: 'Confirm cancel', exact: true })).toBeDisabled();
          await browserExpect(page.getByRole('button', { name: 'Keep workflow', exact: true })).toBeDisabled();
          const saved = await q('SELECT * FROM hr_lifecycle_workflows WHERE id=$1', [active[0].id]), audits = (await snapshot()).audits;
          expect(saved[0].status).toBe('CANCELLED'); expect(writes).toEqual(['POST', 'POST']);
          await page.reload(); await page.addScriptTag({ content: script });
          await browserExpect(page.getByRole('button', { name: 'Start workflow', exact: true })).toBeVisible();
          await browserExpect(page.getByRole('button', { name: 'Cancel workflow', exact: true })).toHaveCount(0);
          expect(await q('SELECT * FROM hr_lifecycle_workflows WHERE id=$1', [active[0].id])).toEqual(saved);
          expect((await snapshot()).audits).toEqual(audits); expect(writes).toEqual(['POST', 'POST']); expect(errors).toEqual([]); return;
        }
        await browserExpect(page.getByRole('button', { name: 'Cancel workflow', exact: true })).toHaveCount(0);
        await browserExpect.poll(async () => (await q('SELECT status FROM hr_lifecycle_workflows WHERE id=$1', [active[0].id]))[0].status).toBe('CANCELLED');
        await browserExpect(page.getByRole('button', { name: 'Confirm cancel', exact: true })).toHaveCount(0);
        const attempts = [...writes]; await page.reload(); await page.addScriptTag({ content: script });
        await browserExpect(page.getByRole('button', { name: 'Start workflow', exact: true })).toBeVisible();
        await browserExpect(page.getByRole('button', { name: 'Cancel workflow', exact: true })).toHaveCount(0);
        expect(writes).toEqual(attempts); expect(writes).toEqual(['POST', 'POST']); expect(errors).toEqual([]); return;
      }
      await page.getByRole('button', { name: 'Add document', exact: true }).click({ timeout: 5000 }).catch(async error => {
        throw new Error(`${String(error)}; errors: ${JSON.stringify(errors)}; rendered: ${await page.locator('body').innerText()}`);
      });
      await page.getByLabel('Document type', { exact: true }).fill('policy'); await page.getByLabel('Title', { exact: true }).fill('Browser policy');
      await page.locator('input[type=file]').setInputFiles({ name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic fixture') });
      if (scenario === 'lost-response') {
        await page.route('**/documents', async route => {
          if (route.request().method() === 'GET') return route.continue();
          const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed');
        });
        await page.getByRole('button', { name: 'Upload document', exact: true }).click();
        await browserExpect(page.getByText(/Upload outcome is unknown/)).toBeVisible();
        await browserExpect(page.getByRole('button', { name: 'Upload document', exact: true })).toBeDisabled();
        const committed = await snapshot(); expect(committed.documents).toHaveLength(1); expect(committed.versions).toHaveLength(1);
        expect(blobs.size).toBe(1); expect(writes).toEqual(['POST']);
        await page.reload(); await page.addScriptTag({ content: script });
        await browserExpect(page.getByText('Browser policy', { exact: true })).toBeVisible();
        expect(await snapshot()).toEqual(committed); expect(writes).toEqual(['POST']); expect(errors).toEqual([]); return;
      }
      if (scenario === 'revoked') {
        await q('DELETE FROM hr_administrators WHERE organisation_id=$1', [org]);
        const before = await snapshot();
        const denied = page.waitForResponse(response => response.request().method() === 'POST');
        await page.getByRole('button', { name: 'Upload document', exact: true }).click();
        expect((await denied).status()).toBe(403);
        await browserExpect(page.getByText('Could not upload document.', { exact: true })).toBeVisible();
        expect(await snapshot()).toEqual(before); expect(blobs.size).toBe(0); expect(writes).toEqual(['POST']);
        await page.reload(); await page.addScriptTag({ content: script });
        await browserExpect(page.getByText('Synthetic Employee', { exact: true })).toBeVisible();
        await browserExpect(page.getByRole('button', { name: 'Add document', exact: true })).toHaveCount(0);
        expect(await snapshot()).toEqual(before); expect(errors).toEqual([]); return;
      }
      await page.getByRole('button', { name: 'Upload document', exact: true }).click();
      await browserExpect(page.getByText('Browser policy', { exact: true })).toBeVisible();
      expect((await snapshot()).versions).toHaveLength(1);
      await page.getByRole('button', { name: 'Add version', exact: true }).click();
      await page.getByLabel('New version file', { exact: true }).setInputFiles({ name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('Replacement fixture') });
      if (scenario === 'lost-version') {
        await page.route('**/versions', async route => {
          if (route.request().method() === 'GET') return route.continue();
          const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed');
        });
        await page.getByRole('button', { name: 'Upload version', exact: true }).click();
        await browserExpect(page.getByText(/Version upload outcome is unknown/)).toBeVisible();
        await browserExpect(page.getByRole('button', { name: 'Upload version', exact: true })).toBeDisabled();
        const committed = await snapshot(); expect(committed.versions).toHaveLength(2); expect(blobs.size).toBe(2);
        expect(writes).toEqual(['POST', 'POST']);
        await page.reload(); await page.addScriptTag({ content: script });
        await browserExpect(page.getByText(/Version 2/).first()).toBeVisible();
        expect(await snapshot()).toEqual(committed); expect(writes).toEqual(['POST', 'POST']); expect(errors).toEqual([]); return;
      }
      await page.getByRole('button', { name: 'Upload version', exact: true }).click();
      await browserExpect(page.getByText(/Version 2/).first()).toBeVisible(); expect((await snapshot()).versions).toHaveLength(2);
      await page.getByRole('button', { name: 'Version history', exact: true }).click();
      await browserExpect(page.getByRole('button', { name: 'Hide version history', exact: true })).toBeVisible();
      if (scenario === 'lost-verification') {
        await page.route('**/verifications', async route => { const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed'); });
        await page.getByRole('button', { name: 'Verify', exact: true }).click();
        await browserExpect(page.getByText(/Assurance outcome is unknown/)).toBeVisible();
        await browserExpect(page.getByRole('button', { name: 'Verify', exact: true })).toBeDisabled();
        const committed = await snapshot(); expect(committed.verifications).toHaveLength(1); const attempts = [...writes];
        await page.reload(); await page.addScriptTag({ content: script });
        await browserExpect(page.getByText(/^Verified \d/)).toBeVisible();
        expect(await snapshot()).toEqual(committed); expect(writes).toEqual(attempts); expect(errors).toEqual([]); return;
      }
      await page.getByRole('button', { name: 'Reject', exact: true }).click();
      await browserExpect(page.getByText(/^Rejected \d/)).toBeVisible();
      await page.getByRole('button', { name: 'Verify', exact: true }).click();
      await browserExpect(page.getByText(/^Verified \d/)).toBeVisible();
      expect((await snapshot()).verifications).toHaveLength(2);
      routeUser = employee.userId;
      await page.reload(); await page.addScriptTag({ content: script });
      await browserExpect(page.getByRole('button', { name: 'Verify', exact: true })).toHaveCount(0);
      if (scenario === 'lost-acknowledgement') {
        await page.route('**/acknowledgements', async route => { const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed'); });
        await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
        await browserExpect(page.getByText(/Assurance outcome is unknown/)).toBeVisible();
        await browserExpect(page.getByRole('button', { name: 'Acknowledge', exact: true })).toBeDisabled();
        const committed = await snapshot(); expect(committed.acknowledgements).toHaveLength(1); const attempts = [...writes];
        await page.reload(); await page.addScriptTag({ content: script });
        await browserExpect(page.getByText(/^Acknowledged \d/)).toBeVisible();
        await browserExpect(page.getByRole('button', { name: 'Acknowledge', exact: true })).toHaveCount(0);
        expect(await snapshot()).toEqual(committed); expect(writes).toEqual(attempts); expect(errors).toEqual([]); return;
      }
      await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
      await browserExpect(page.getByText(/^Acknowledged \d/)).toBeVisible();
      expect((await snapshot()).acknowledgements).toHaveLength(1);
      await browserExpect(page.getByRole('button', { name: 'Add document', exact: true })).toHaveCount(0);
      routeUser = hr.userId;
      await page.reload(); await page.addScriptTag({ content: script });
      await browserExpect(page.getByText(/^Acknowledged \d/)).toBeVisible();
      if (scenario === 'lost-delete') {
        await page.route('**/documents/*', async route => {
          if (route.request().method() !== 'DELETE') return route.continue();
          const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
        });
      }
      await page.getByRole('button', { name: 'Delete', exact: true }).click(); await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
      if (scenario === 'lost-delete') {
        await browserExpect(page.getByText(/Deletion outcome is unknown/)).toBeVisible();
        await browserExpect(page.getByRole('button', { name: 'Confirm delete', exact: true })).toBeDisabled();
        const committed = await snapshot(); expect(committed.documents[0].deleted_at).not.toBeNull();
        expect(committed.versions).toHaveLength(2); expect(committed.acknowledgements).toHaveLength(1); expect(committed.verifications).toHaveLength(2);
        const attempts = [...writes];
        await page.reload(); await page.addScriptTag({ content: script });
        await browserExpect(page.getByRole('button', { name: 'Add document', exact: true })).toBeVisible();
        await browserExpect(page.getByText('Browser policy', { exact: true })).toHaveCount(0);
        expect(await snapshot()).toEqual(committed); expect(writes).toEqual(attempts); expect(blobs.size).toBe(2); expect(errors).toEqual([]); return;
      }
      await browserExpect(page.getByText('Browser policy', { exact: true })).toHaveCount(0);
      const saved = await snapshot(); expect(saved.documents[0].deleted_at).not.toBeNull(); expect(saved.versions).toHaveLength(2);
      expect(saved.acknowledgements).toHaveLength(1); expect(saved.verifications).toHaveLength(2);
      expect(blobs.size).toBe(2); expect(writes).toEqual(['POST', 'POST', 'POST', 'POST', 'POST', 'DELETE']); expect(errors).toEqual([]);
    } finally { await browser.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); }); }
  }, 60_000);
  it('executes multipart upload, version history, acknowledgement, verification and deletion through real routes', async () => {
    const uploaded = await routes.POST(routeRequest('POST', multipart(true)), routeParams());
    expect(uploaded.status).toBe(201);
    const first = await uploaded.json(); const documentId = first.document.id;
    const replacement = await versions.POST(routeRequest('POST', multipart()), routeParams(documentId));
    expect(replacement.status).toBe(201); const second = await replacement.json();
    const history = await versions.GET(routeRequest('GET'), routeParams(documentId));
    expect(history.status).toBe(200);
    expect((await history.json()).versions.map((row: { version_number: number; is_current: boolean }) => [row.version_number, row.is_current]).sort())
      .toEqual([[1, false], [2, true]]);
    routeUser = employee.userId;
    expect((await acknowledge.POST(routeRequest('POST'), routeParams(documentId, second.version.id))).status).toBe(201);
    expect((await acknowledge.POST(routeRequest('POST'), routeParams(documentId, second.version.id))).status).toBe(200);
    routeUser = hr.userId;
    expect((await verify.POST(routeRequest('POST', { decision: 'VERIFIED' }), routeParams(documentId, second.version.id))).status).toBe(201);
    const listed = await routes.GET(routeRequest('GET'), routeParams());
    expect(listed.status).toBe(200); expect((await listed.json()).documents).toHaveLength(1);
    const beforeDelete = await snapshot();
    expect((await remove.DELETE(routeRequest('DELETE'), routeParams(documentId))).status).toBe(200);
    expect((await (await routes.GET(routeRequest('GET'), routeParams())).json()).documents).toHaveLength(0);
    const afterDelete = await snapshot(); expect(afterDelete.versions).toEqual(beforeDelete.versions);
    expect(afterDelete.acknowledgements).toEqual(beforeDelete.acknowledgements); expect(afterDelete.verifications).toEqual(beforeDelete.verifications);
    expect(blobs.size).toBe(2);
  });
  it('denies unauthenticated and revoked administration routes before multipart storage or database changes', async () => {
    const created = await create(); const params = routeParams(created.document.id, created.version.id);
    authenticated = false; const before = await snapshot();
    expect((await routes.POST(routeRequest('POST', multipart(true)), routeParams())).status).toBe(401);
    expect((await versions.POST(routeRequest('POST', multipart()), params)).status).toBe(401);
    expect((await acknowledge.POST(routeRequest('POST'), params)).status).toBe(401);
    expect((await verify.POST(routeRequest('POST', { decision: 'VERIFIED' }), params)).status).toBe(401);
    expect((await remove.DELETE(routeRequest('DELETE'), params)).status).toBe(401);
    expect(await snapshot()).toEqual(before);
    authenticated = true; await q('DELETE FROM hr_administrators WHERE organisation_id=$1', [org]); const revoked = await snapshot();
    expect((await routes.POST(routeRequest('POST', multipart(true)), routeParams())).status).toBe(403);
    expect((await versions.POST(routeRequest('POST', multipart()), params)).status).toBe(403);
    expect((await remove.DELETE(routeRequest('DELETE'), params)).status).toBe(403);
    expect(await snapshot()).toEqual(revoked); expect(blobs.size).toBe(1);
  });
  it('creates immutable versions and serializes competing version uploads to one current version', async () => {
    const created = await create();
    const outcomes = await Promise.all([1, 2].map(() => documents.addEmployeeDocumentVersion({ actor: hr, personId, documentId: created.document.id, ...upload })));
    expect(outcomes.map(result => result.outcome)).toEqual(['created', 'created']);
    expect(await q('SELECT version_number,is_current FROM hr_employee_document_versions WHERE organisation_id=$1 ORDER BY version_number', [org]))
      .toEqual([{ version_number: 1, is_current: false }, { version_number: 2, is_current: false }, { version_number: 3, is_current: true }]);
    expect(blobs.size).toBe(3);
  });
  it('records one acknowledgement under concurrent linked-employee requests', async () => {
    const created = await create();
    const input = { actor: employee, personId, documentId: created.document.id, versionId: created.version.id };
    const results = await Promise.all([assurance.acknowledgeEmployeeDocumentVersion(input), assurance.acknowledgeEmployeeDocumentVersion(input)]);
    expect(results.map(result => result.outcome).sort()).toEqual(['already_acknowledged', 'recorded']);
    expect((await snapshot()).acknowledgements).toHaveLength(1);
  });
  it('keeps verification decisions append-only', async () => {
    const created = await create(); const input = { actor: hr, personId, documentId: created.document.id, versionId: created.version.id, comment: null };
    expect((await assurance.verifyEmployeeDocumentVersion({ ...input, decision: 'REJECTED' })).outcome).toBe('recorded');
    expect((await assurance.verifyEmployeeDocumentVersion({ ...input, decision: 'VERIFIED' })).outcome).toBe('recorded');
    expect((await snapshot()).verifications).toHaveLength(2);
  });
  it('denies outsider assurance and revoked-HR uploads without database or orphan storage changes', async () => {
    const created = await create();
    await q('DELETE FROM hr_administrators WHERE organisation_id=$1', [org]);
    const before = await snapshot();
    expect((await assurance.acknowledgeEmployeeDocumentVersion({ actor: outsider, personId, documentId: created.document.id, versionId: created.version.id })).outcome).toBe('forbidden');
    expect((await assurance.verifyEmployeeDocumentVersion({ actor: hr, personId, documentId: created.document.id, versionId: created.version.id, decision: 'VERIFIED', comment: null })).outcome).toBe('forbidden');
    expect((await documents.addEmployeeDocumentVersion({ actor: hr, personId, documentId: created.document.id, ...upload })).outcome).toBe('forbidden');
    expect((await documents.createEmployeeDocumentWithVersion({ actor: hr, personId, documentType: 'policy', title: 'Denied', lifecycleTaskId: null, ...upload })).outcome).toBe('forbidden');
    expect((await documents.softDeleteEmployeeDocument({ actor: hr, personId, documentId: created.document.id })).outcome).toBe('forbidden');
    expect(await snapshot()).toEqual(before); expect(blobs.size).toBe(1);
  });
  it('soft deletes the logical document while preserving immutable version history', async () => {
    const created = await create(); const versions = (await snapshot()).versions;
    expect((await documents.softDeleteEmployeeDocument({ actor: hr, personId, documentId: created.document.id })).outcome).toBe('deleted');
    expect((await snapshot()).documents[0].deleted_at).not.toBeNull();
    expect((await snapshot()).versions).toEqual(versions); expect(blobs.size).toBe(1);
  });
  it('rolls back a version change and cleans its uploaded blob when audit insertion fails', async () => {
    const created = await create(); const before = await snapshot();
    await q("ALTER TABLE audit_logs ADD CONSTRAINT document_proof_reject_audit CHECK (action <> 'hr_employee_document_version.created') NOT VALID");
    try {
      await expect(documents.addEmployeeDocumentVersion({ actor: hr, personId, documentId: created.document.id, ...upload }))
        .rejects.toMatchObject({ code: '23514', constraint: 'document_proof_reject_audit' });
      expect(await snapshot()).toEqual(before); expect(blobs.size).toBe(1);
    } finally { await q('ALTER TABLE audit_logs DROP CONSTRAINT document_proof_reject_audit'); }
    expect((await documents.addEmployeeDocumentVersion({ actor: hr, personId, documentId: created.document.id, ...upload })).outcome).toBe('created');
  });
  it.each(['acknowledgement', 'verification'] as const)('rolls back %s when its audit fails, then recovers', async action => {
    const created = await create(); const before = await snapshot();
    const perform = () => action === 'acknowledgement'
      ? assurance.acknowledgeEmployeeDocumentVersion({ actor: employee, personId, documentId: created.document.id, versionId: created.version.id })
      : assurance.verifyEmployeeDocumentVersion({ actor: hr, personId, documentId: created.document.id, versionId: created.version.id, decision: 'VERIFIED', comment: null });
    // action is a fixed test case, never application input.
    await q(`ALTER TABLE audit_logs ADD CONSTRAINT document_proof_reject_audit
      CHECK (action <> 'hr_employee_document_${action}.created') NOT VALID`);
    try {
      await expect(perform()).rejects.toMatchObject({ code: '23514', constraint: 'document_proof_reject_audit' });
      expect(await snapshot()).toEqual(before);
    } finally { await q('ALTER TABLE audit_logs DROP CONSTRAINT document_proof_reject_audit'); }
    expect((await perform()).outcome).toBe('recorded');
  });
});

describe('reminder current-version and recipient entitlement SQL', () => {
  it('uses real SQL to suppress superseded, unlinked, revoked, inactive and foreign-tenant recipients', async () => {
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email text,
      ADD COLUMN IF NOT EXISTS display_name text, ADD COLUMN IF NOT EXISTS status text DEFAULT 'ACTIVE',
      ADD COLUMN IF NOT EXISTS role text DEFAULT 'VIEWER'`);
    await q("UPDATE users SET email='synthetic@example.invalid', status='ACTIVE', role='VIEWER' WHERE organisation_id=$1", [org]);
    await q('UPDATE hr_people SET linked_user_id=$1 WHERE id=$2', [employee.userId, personId]);
    const created = await create();
    const { createEmployeeDocumentReminderEmailTransport } = await import('@/lib/hr/employeeDocumentReminderEmailTransport');
    const sender = vi.fn().mockResolvedValue({ status: 'sent', id: 'synthetic' });
    const delivery = { id: '96666666-6666-4666-8666-666666666666', documentVersionId: created.version.id,
      recipientUserId: employee.userId, reminderType: 'acknowledgement_due', scheduledFor: '2026-10-13',
      deliveryStatus: 'CLAIMED' as const, claimedAt: '2026-10-13', sentAt: null, failedAt: null, failureCode: null };
    const transport = createEmployeeDocumentReminderEmailTransport({ organisationId: org, sender });
    expect((await transport(delivery)).outcome).toBe('sent');
    await q('UPDATE hr_employee_document_versions SET is_current=false WHERE id=$1', [created.version.id]);
    sender.mockClear(); expect((await transport(delivery)).outcome).toBe('definite_failure'); expect(sender).not.toHaveBeenCalled();
    await q('UPDATE hr_employee_document_versions SET is_current=true WHERE id=$1', [created.version.id]);
    await q('UPDATE hr_people SET linked_user_id=NULL WHERE id=$1', [personId]);
    expect((await transport(delivery)).outcome).toBe('definite_failure'); expect(sender).not.toHaveBeenCalled();
    const hrDelivery = { ...delivery, recipientUserId: hr.userId };
    expect((await transport(hrDelivery)).outcome).toBe('sent');
    await q('DELETE FROM hr_administrators WHERE organisation_id=$1 AND user_id=$2', [org, hr.userId]);
    sender.mockClear(); expect((await transport(hrDelivery)).outcome).toBe('definite_failure'); expect(sender).not.toHaveBeenCalled();
    await q("UPDATE users SET role='SUPER_ADMIN' WHERE id=$1", [hr.userId]);
    expect((await transport(hrDelivery)).outcome).toBe('sent');
    await q("UPDATE users SET status='DISABLED' WHERE id=$1", [hr.userId]);
    sender.mockClear(); expect((await transport(hrDelivery)).outcome).toBe('definite_failure'); expect(sender).not.toHaveBeenCalled();
    const otherTenant = createEmployeeDocumentReminderEmailTransport({ organisationId: 'other-fixture-org', sender });
    expect((await otherTenant(delivery)).outcome).toBe('definite_failure'); expect(sender).not.toHaveBeenCalled();
  });
});

describe('restricted case real route access and history', () => {
  it('requires an explicit live grant even for HR and preserves revocation history', async () => {
    await q(readFileSync('scripts/add-hr-people-tenant-unique.sql', 'utf8'));
    await q(readFileSync('scripts/create-hr-restricted-cases.sql', 'utf8'));
    const caseId = '97777777-7777-4777-8777-777777777777';
    await q("INSERT INTO hr_restricted_cases(id,organisation_id,case_type,title,opened_by) VALUES($1,$2,'other','Synthetic restricted case',$3)", [caseId, org, hr.userId]);
    const detail = await import('@/app/api/hr/restricted-cases/[id]/route');
    const params = { params: Promise.resolve({ id: caseId }) };
    routeUser = hr.userId;
    expect((await detail.GET(routeRequest('GET'), params)).status).toBe(404);
    await q('INSERT INTO hr_restricted_case_access(organisation_id,case_id,user_id,granted_by) VALUES($1,$2,$3,$4)', [org, caseId, employee.userId, hr.userId]);
    routeUser = employee.userId;
    expect((await detail.GET(routeRequest('GET'), params)).status).toBe(200);
    await q('UPDATE hr_restricted_case_access SET revoked_at=now(),revoked_by=$1 WHERE case_id=$2', [hr.userId, caseId]);
    expect((await detail.GET(routeRequest('GET'), params)).status).toBe(404);
    routeUser = outsider.userId;
    expect((await detail.GET(routeRequest('GET'), params)).status).toBe(404);
    authenticated = false;
    expect((await detail.GET(routeRequest('GET'), params)).status).toBe(401);
    expect((await q('SELECT count(*)::int AS count FROM hr_restricted_case_access WHERE case_id=$1 AND revoked_at IS NOT NULL', [caseId]))[0].count).toBe(1);
  });
});

describe('restricted detail browser to actual route', () => {
  it.each(['revoked', 'lost-note', 'lost-participant', 'lost-grant'] as const)('restricted detail actual-route recovery: %s', async scenario => {
    await q(readFileSync('scripts/add-hr-people-tenant-unique.sql', 'utf8'));
    await q(readFileSync('scripts/create-hr-restricted-cases.sql', 'utf8'));
    const caseId = scenario === 'revoked' ? '98888888-8888-4888-8888-888888888888' : scenario === 'lost-note' ? '98888888-8888-4888-8888-888888888889' : scenario === 'lost-participant' ? '98888888-8888-4888-8888-888888888890' : '98888888-8888-4888-8888-888888888891';
    await q("INSERT INTO hr_restricted_cases(id,organisation_id,case_type,title,opened_by) VALUES($1,$2,'other','Browser synthetic restricted case',$3)", [caseId, org, hr.userId]);
    await q('INSERT INTO hr_restricted_case_access(organisation_id,case_id,user_id,granted_by) VALUES($1,$2,$3,$4)', [org, caseId, employee.userId, hr.userId]);
    routeUser = ['lost-participant', 'lost-grant'].includes(scenario) ? hr.userId : employee.userId;
    if (['lost-participant', 'lost-grant'].includes(scenario)) await q('INSERT INTO hr_restricted_case_access(organisation_id,case_id,user_id,granted_by) VALUES($1,$2,$3,$3)', [org, caseId, hr.userId]);
    const detail = await import('@/app/api/hr/restricted-cases/[id]/route');
    const noteRoutes = await import('@/app/api/hr/restricted-cases/[id]/notes/route');
    const grantRoute = await import('@/app/api/hr/restricted-cases/[id]/access/route');
    const participantRoutes = await import('@/app/api/hr/restricted-cases/[id]/participants/route');
    const built = await build({ configFile: false, logLevel: 'error', resolve: { alias: { '@': process.cwd() } },
      define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.env': '{}' }, oxc: { jsx: { runtime: 'automatic', development: false } },
      plugins: [{ name: 'restricted-browser-proof', resolveId(id) {
        if (id === 'restricted-entry' || id.replaceAll('\\', '/').endsWith('/restricted-entry')) return '\0restricted-entry';
        if (id === 'next/link') return '\0restricted-link';
      }, load(id) {
        if (id === '\0restricted-link') return "import {createElement} from 'react'; export default function Link(props){return createElement('a',props)}";
        if (id === '\0restricted-entry') return `import {createElement,Suspense} from 'react'; import {createRoot} from 'react-dom/client'; import Page from ${JSON.stringify(path.resolve('app/people/restricted-cases/[id]/page.tsx').replaceAll('\\', '/'))}; createRoot(document.getElementById('root')).render(createElement(Suspense,{fallback:'Loading'},createElement(Page,{params:Promise.resolve({id:${JSON.stringify(caseId)}})})));`;
      } }], build: { write: false, lib: { entry: 'restricted-entry', name: 'RestrictedProof', formats: ['iife'] } } });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Expected browser output');
    let actualReads = 0; let actualWrites = 0;
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, 'http://fixture.local');
        if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div>'); return; }
        res.setHeader('Content-Type', 'application/json');
        if (url.pathname === `/api/hr/restricted-cases/${caseId}`) {
          actualReads++;
          const response = await detail.GET(new NextRequest(url), { params: Promise.resolve({ id: caseId }) });
          res.statusCode = response.status; res.end(await response.text()); return;
        }
        if (url.pathname === `/api/hr/restricted-cases/${caseId}/access`) {
          actualWrites++; const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const response = await grantRoute.POST(new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: Buffer.concat(chunks).toString() }), { params: Promise.resolve({ id: caseId }) });
          res.statusCode=response.status; res.end(await response.text()); return;
        }
        if (url.pathname === `/api/hr/restricted-cases/${caseId}/notes` || url.pathname === `/api/hr/restricted-cases/${caseId}/participants`) {
          const handlers = url.pathname.endsWith('/participants') ? participantRoutes : noteRoutes;
          const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const method = req.method ?? 'GET';
          if (method === 'POST') actualWrites++;
          const request = new NextRequest(url, { method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: Buffer.concat(chunks).toString() } : {}) });
          const response = method === 'POST' ? await handlers.POST(request, { params: Promise.resolve({ id: caseId }) }) : await handlers.GET(request, { params: Promise.resolve({ id: caseId }) });
          res.statusCode = response.status; res.end(await response.text()); return;
        }
        if (url.pathname.endsWith('/administrators')) { res.statusCode=['lost-participant', 'lost-grant'].includes(scenario) ? 200 : 403; res.end(JSON.stringify({ users: [{ id: outsider.userId, name: 'Synthetic recipient', email: null, grant_eligible: true }] })); return; }
        const body = url.pathname.endsWith('/participants') ? { participants: [] }
          : url.pathname.endsWith('/notes') ? { notes: [] } : url.pathname.endsWith('/documents') ? { documents: [] } : { people: [{ id: personId, first_name: 'Synthetic', last_name: 'Participant' }] };
        res.end(JSON.stringify(body));
      } catch { res.statusCode=500; res.end('{}'); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing loopback address');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage(); const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}/`); await page.addScriptTag({ content: output.output[0].code });
      await browserExpect(page.getByRole('heading', { name: 'Browser synthetic restricted case' })).toBeVisible();
      if (scenario === 'lost-grant') {
        await page.route('**/access', async route => { const response=await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed'); });
        await page.getByRole('combobox', { name: 'User', exact: true }).selectOption(outsider.userId);
        await page.getByRole('button', { name: 'Grant access', exact: true }).click();
        await browserExpect(page.getByText('The change could not be confirmed. Refresh and review the case before trying again.')).toBeVisible();
        await browserExpect(page.getByRole('button', { name: 'Grant access', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await browserExpect(page.getByRole('heading', { name: 'Browser synthetic restricted case' })).toBeVisible();
        expect(actualWrites).toBe(1);
        expect((await q('SELECT count(*)::int AS count FROM hr_restricted_case_access WHERE case_id=$1 AND user_id=$2 AND revoked_at IS NULL', [caseId, outsider.userId]))[0].count).toBe(1);
        expect(errors).toEqual([]); return;
      }
      if (scenario === 'lost-participant') {
        await page.route('**/participants', async route => {
          if (route.request().method() !== 'POST') return route.continue();
          const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed');
        });
        await page.getByRole('combobox', { name: 'Participant', exact: true }).selectOption(personId);
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        await browserExpect(page.getByText('The change could not be confirmed. Refresh and review the case before trying again.')).toBeVisible();
        await browserExpect(page.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await browserExpect(page.getByRole('button', { name: 'Remove Synthetic Participant from this case' })).toBeVisible();
        expect(actualWrites).toBe(1);
        expect((await q('SELECT count(*)::int AS count FROM hr_restricted_case_participants WHERE case_id=$1', [caseId]))[0].count).toBe(1);
        expect(errors).toEqual([]); return;
      }
      if (scenario === 'lost-note') {
        await page.route('**/notes', async route => {
          if (route.request().method() !== 'POST') return route.continue();
          const response = await route.fetch(); expect(response.status()).toBe(201);
          await route.abort('failed');
        });
        await page.getByRole('textbox', { name: 'New case note' }).fill('Committed synthetic restricted note');
        await page.getByRole('button', { name: 'Add note', exact: true }).click();
        await browserExpect(page.getByText('The change could not be confirmed. Refresh and review the case before trying again.')).toBeVisible();
        await browserExpect(page.getByRole('button', { name: 'Add note', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await browserExpect(page.getByText('Committed synthetic restricted note', { exact: true })).toBeVisible();
        expect(actualWrites).toBe(1);
        expect((await q('SELECT count(*)::int AS count FROM hr_restricted_case_notes WHERE case_id=$1', [caseId]))[0].count).toBe(1);
        expect(errors).toEqual([]); return;
      }
      await q('UPDATE hr_restricted_case_access SET revoked_at=now(),revoked_by=$1 WHERE case_id=$2', [hr.userId, caseId]);
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await browserExpect(page.getByText('Could not load restricted HR case. Refresh to try again.')).toBeVisible();
      await browserExpect(page.getByRole('heading', { name: 'Browser synthetic restricted case' })).toHaveCount(0);
      expect(actualReads).toBe(2); expect(errors).toEqual([]);
    } finally { await browser.close(); await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});

describe('reminder batch real ledger failure isolation', () => {
  it('leaves an accepted send CLAIMED after terminal SQL failure and processes later rows without replay', async () => {
    const created = await create();
    const ids = ['99999999-9999-4999-8999-999999999991', '99999999-9999-4999-8999-999999999992', '99999999-9999-4999-8999-999999999993'];
    for (let i=0;i<ids.length;i++) await q(`INSERT INTO hr_employee_document_reminder_deliveries(id,organisation_id,document_version_id,recipient_user_id,reminder_type,scheduled_for)
      VALUES($1,$2,$3,$4,'acknowledgement_due',$5::date)`, [ids[i], org, created.version.id, employee.userId, `2026-10-0${i+1}`]);
    await q(`CREATE FUNCTION proof_reminder_terminal_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id='99999999-9999-4999-8999-999999999991'::uuid AND NEW.delivery_status='SENT' THEN RAISE EXCEPTION 'synthetic terminal failure'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER proof_reminder_terminal_failure BEFORE UPDATE ON hr_employee_document_reminder_deliveries FOR EACH ROW EXECUTE FUNCTION proof_reminder_terminal_failure()`);
    try {
      const { processDueEmployeeDocumentReminders } = await import('@/lib/hr/employeeDocumentReminderWorker');
      const transport = vi.fn().mockResolvedValue({ outcome: 'sent' });
      const params = { actor: { organisationId: org, userId: hr.userId }, scheduledThrough: '2026-10-13', transport };
      const result = await processDueEmployeeDocumentReminders(params);
      expect(result).toMatchObject({ claimed: 3, sent: 2, transitionSkipped: 1 });
      expect(transport).toHaveBeenCalledTimes(3);
      expect((await q('SELECT delivery_status FROM hr_employee_document_reminder_deliveries WHERE id=$1', [ids[0]]))[0].delivery_status).toBe('CLAIMED');
      expect((await processDueEmployeeDocumentReminders(params)).claimed).toBe(0);
      expect(transport).toHaveBeenCalledTimes(3);
    } finally {
      await q('DROP TRIGGER proof_reminder_terminal_failure ON hr_employee_document_reminder_deliveries; DROP FUNCTION proof_reminder_terminal_failure()');
      await q('DELETE FROM hr_employee_document_reminder_deliveries WHERE organisation_id=$1', [org]);
    }
  });
});
