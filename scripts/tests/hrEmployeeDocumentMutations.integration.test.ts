import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

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
  await q('INSERT INTO organisations(id,name,slug) VALUES ($1,$1,$1)', [org]);
  for (const userId of [hr.userId, employee.userId, outsider.userId]) {
    await q('INSERT INTO users(id,organisation_id,username,name) VALUES ($1,$2,$1,$1)', [userId, org]);
  }
  await q('INSERT INTO hr_people(id,organisation_id,linked_user_id,first_name,last_name) VALUES ($1,$2,$3,$4,$5)', [personId, org, employee.userId, 'Synthetic', 'Employee']);
});
beforeEach(async () => {
  blobs.clear();
  for (const table of ['hr_employee_document_acknowledgements', 'hr_employee_document_verifications', 'hr_employee_document_versions', 'hr_employee_documents', 'audit_logs', 'hr_administrators']) {
    await q(`DELETE FROM ${table} WHERE organisation_id=$1`, [org]);
  }
  await q('INSERT INTO hr_administrators(organisation_id,user_id) VALUES ($1,$2)', [org, hr.userId]);
});
afterAll(async () => { await pool.end(); });
describe('Employee document mutations against Postgres with in-memory storage', () => {
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
