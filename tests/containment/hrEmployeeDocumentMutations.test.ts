import { beforeEach, describe, expect, it, vi } from 'vitest';

type QuerySpec = { text: string; values: unknown[] };
let responses: unknown[] = [];
let callCount = 0;
let calls: QuerySpec[] = [];

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]): QuerySpec => ({
  text: strings.join('?'),
  values,
}));

const transactionMock = vi.fn(async (build: (txn: typeof sqlMock) => QuerySpec[]) => {
  const queries = build(sqlMock);
  const results: unknown[] = [];
  for (const query of queries) {
    calls.push(query);
    results.push(responses[callCount++] ?? []);
  }
  return results;
});

vi.mock('@/lib/db', () => ({
  default: Object.assign(
    (...args: [TemplateStringsArray, ...unknown[]]) => sqlMock(...args),
    {
      transaction: (...args: unknown[]) =>
        transactionMock(...(args as [(txn: typeof sqlMock) => QuerySpec[]])),
    },
  ),
}));

const putMock = vi.fn(async () => ({
  key: 'employee-doc-key',
  provider: 'test',
  size: 4,
}));
const deleteMock = vi.fn(async () => undefined);
const getMock = vi.fn(async () => ({
  metadata: { provider: 'test', size: 4 },
  body: new Uint8Array([1, 2, 3, 4]),
}));
const storeFactoryMock = vi.fn(() => ({
  provider: 'test',
  put: putMock,
  delete: deleteMock,
  get: getMock,
  head: vi.fn(),
}));

vi.mock('@/lib/hr/employeeDocumentStorage', () => ({
  buildEmployeeHrDocumentVersionKey: () => 'employee-doc-key',
  createEmployeeHrDocumentStore: () => storeFactoryMock(),
}));

const {
  addEmployeeDocumentVersion,
  createEmployeeDocumentWithVersion,
  downloadEmployeeDocumentVersionBytes,
  softDeleteEmployeeDocument,
} = await import('@/lib/hr/employeeDocumentMutations');

const ACTOR = {
  organisationId: 'org-a',
  userId: 'hr-user',
  isSuperAdmin: false,
  ipAddress: '203.0.113.20',
  userAgent: 'vitest',
};
const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';

function queue(...items: unknown[]) {
  responses = items;
  callCount = 0;
}

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    allowed: true,
    person_exists: true,
    lifecycle_task_valid: true,
    document_id: DOCUMENT_ID,
    document_type: 'certification',
    title: 'Forklift certificate',
    lifecycle_task_id: null,
    document_created_at: '2026-09-26T00:00:00.000Z',
    version_id: VERSION_ID,
    version_number: 1,
    uploaded_by: 'hr-user',
    original_filename: 'certificate.pdf',
    content_type: 'application/pdf',
    byte_size: 4,
    expires_at: '2027-09-26',
    is_current: true,
    version_created_at: '2026-09-26T00:00:00.000Z',
    document_audit_written: true,
    version_audit_written: true,
    ...overrides,
  };
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    document_exists: true,
    allowed: true,
    version_id: VERSION_ID,
    version_number: 2,
    uploaded_by: 'hr-user',
    original_filename: 'certificate-v2.pdf',
    content_type: 'application/pdf',
    byte_size: 4,
    expires_at: null,
    is_current: true,
    created_at: '2026-09-26T01:00:00.000Z',
    version_audit_written: true,
    supersede_audit_written: true,
    ...overrides,
  };
}

beforeEach(() => {
  responses = [];
  callCount = 0;
  calls = [];
  sqlMock.mockClear();
  transactionMock.mockClear();
  putMock.mockClear();
  deleteMock.mockClear();
  getMock.mockClear();
  storeFactoryMock.mockClear();
});

describe('HR-7D4 employee document mutations', () => {
  it('creates logical document + v1 + both audits inside one DB transaction', async () => {
    queue([{ locked: null }], [createRow()]);

    const result = await createEmployeeDocumentWithVersion({
      actor: ACTOR,
      personId: PERSON_ID,
      documentType: 'certification',
      title: 'Forklift certificate',
      lifecycleTaskId: null,
      originalFilename: 'certificate.pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3, 4]),
      expiresAt: '2027-09-26',
    });

    expect(result.outcome).toBe('created');
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('pg_advisory_xact_lock');
    expect(calls[1].text).toContain('INSERT INTO hr_employee_documents');
    expect(calls[1].text).toContain('INSERT INTO hr_employee_document_versions');
    expect(calls[1].text.match(/INSERT INTO audit_logs/g)).toHaveLength(2);
    expect(calls[1].text).toContain("'hr_employee_document.created'");
    expect(calls[1].text).toContain("'hr_employee_document_version.created'");
    expect(calls[1].text).toContain('t.person_id = ?::uuid');
    const versionAudit = calls[1].text.split('version_audit AS (')[1] ?? '';
    expect(versionAudit).not.toContain("'storage_key'");
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('cleans the Blob when transactional audit invariants fail', async () => {
    queue([{ locked: null }], [createRow({ version_audit_written: false })]);

    await expect(createEmployeeDocumentWithVersion({
      actor: ACTOR,
      personId: PERSON_ID,
      documentType: 'certification',
      title: 'Forklift certificate',
      lifecycleTaskId: null,
      originalFilename: 'certificate.pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3, 4]),
      expiresAt: null,
    })).rejects.toThrow(/business and audit state/);

    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it('serializes new versions, supersedes the old current version, and audits both changes', async () => {
    queue([{ locked: null }], [versionRow()]);

    const result = await addEmployeeDocumentVersion({
      actor: ACTOR,
      personId: PERSON_ID,
      documentId: DOCUMENT_ID,
      originalFilename: 'certificate-v2.pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3, 4]),
      expiresAt: null,
    });

    expect(result).toEqual({
      outcome: 'created',
      version: expect.objectContaining({
        document_id: DOCUMENT_ID,
        version_number: 2,
        is_current: true,
      }),
    });
    expect(calls[0].text).toContain('pg_advisory_xact_lock');
    expect(calls[1].text).toContain('SET is_current = false');
    expect(calls[1].text).toContain('max(v.version_number) + 1');
    expect(calls[1].text).toContain("'hr_employee_document_version.superseded'");
    expect(calls[1].text).toContain("'hr_employee_document_version.created'");
    expect(calls[1].text.match(/INSERT INTO audit_logs/g)).toHaveLength(2);
  });

  it('soft-deletes metadata atomically without deleting immutable version bytes', async () => {
    queue(
      [{ locked: null }],
      [{
        document_exists: true,
        allowed: true,
        document_id: DOCUMENT_ID,
        deleted_at: '2026-09-26T02:00:00.000Z',
        audit_written: true,
      }],
    );

    await expect(softDeleteEmployeeDocument({
      actor: ACTOR,
      personId: PERSON_ID,
      documentId: DOCUMENT_ID,
    })).resolves.toEqual({
      outcome: 'deleted',
      deletedAt: '2026-09-26T02:00:00.000Z',
    });

    expect(calls[1].text).toContain('UPDATE hr_employee_documents');
    expect(calls[1].text).toContain("'hr_employee_document.deleted'");
    expect(calls[1].text).not.toContain('DELETE FROM hr_employee_document_versions');
    expect(storeFactoryMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('rejects invalid file types before Blob or database writes', async () => {
    await expect(createEmployeeDocumentWithVersion({
      actor: ACTOR,
      personId: PERSON_ID,
      documentType: 'certification',
      title: 'Bad',
      lifecycleTaskId: null,
      originalFilename: 'bad.exe',
      contentType: 'application/x-msdownload',
      bytes: new Uint8Array([1]),
      expiresAt: null,
    })).resolves.toEqual({
      outcome: 'invalid',
      error: 'File type "application/x-msdownload" is not allowed.',
    });

    expect(putMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('downloads through the dedicated store with the employee-document byte ceiling', async () => {
    const body = await downloadEmployeeDocumentVersionBytes({ storageKey: 'employee-doc-key' });
    expect([...body]).toEqual([1, 2, 3, 4]);
    expect(getMock).toHaveBeenCalledWith('employee-doc-key', { maxBytes: 20 * 1024 * 1024 });
  });
});
