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
});
afterAll(async () => { await pool.end(); });
describe('Employee document mutations against Postgres with in-memory storage', () => {
  it('uploads, replaces and deletes through the real drawer, loopback HTTP and Postgres', async () => {
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
      if (url.pathname.startsWith('/api/hr/lifecycle/')) result = NextResponse.json({ workflows: [], capabilities: { can_start_workflow: false } });
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
      await page.getByRole('button', { name: 'Add document', exact: true }).click({ timeout: 5000 }).catch(async error => {
        throw new Error(`${String(error)}; errors: ${JSON.stringify(errors)}; rendered: ${await page.locator('body').innerText()}`);
      });
      await page.getByLabel('Document type', { exact: true }).fill('policy'); await page.getByLabel('Title', { exact: true }).fill('Browser policy');
      await page.locator('input[type=file]').setInputFiles({ name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic fixture') });
      await page.getByRole('button', { name: 'Upload document', exact: true }).click();
      await browserExpect(page.getByText('Browser policy', { exact: true })).toBeVisible();
      expect((await snapshot()).versions).toHaveLength(1);
      await page.getByRole('button', { name: 'Add version', exact: true }).click();
      await page.getByLabel('New version file', { exact: true }).setInputFiles({ name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('Replacement fixture') });
      await page.getByRole('button', { name: 'Upload version', exact: true }).click();
      await browserExpect(page.getByText(/Version 2/).first()).toBeVisible(); expect((await snapshot()).versions).toHaveLength(2);
      await page.getByRole('button', { name: 'Version history', exact: true }).click();
      await browserExpect(page.getByRole('button', { name: 'Hide version history', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Reject', exact: true }).click();
      await browserExpect(page.getByText(/^Rejected \d/)).toBeVisible();
      await page.getByRole('button', { name: 'Verify', exact: true }).click();
      await browserExpect(page.getByText(/^Verified \d/)).toBeVisible();
      expect((await snapshot()).verifications).toHaveLength(2);
      routeUser = employee.userId;
      await page.reload(); await page.addScriptTag({ content: script });
      await browserExpect(page.getByRole('button', { name: 'Verify', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
      await browserExpect(page.getByText(/^Acknowledged \d/)).toBeVisible();
      expect((await snapshot()).acknowledgements).toHaveLength(1);
      await browserExpect(page.getByRole('button', { name: 'Add document', exact: true })).toHaveCount(0);
      routeUser = hr.userId;
      await page.reload(); await page.addScriptTag({ content: script });
      await browserExpect(page.getByText(/^Acknowledged \d/)).toBeVisible();
      await page.getByRole('button', { name: 'Delete', exact: true }).click(); await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
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
