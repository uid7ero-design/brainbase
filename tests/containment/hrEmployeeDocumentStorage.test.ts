import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('employee HR document storage composition', () => {
  it('uses its own private-store credential pair', async () => {
    const { createEmployeeHrDocumentStore } = await import('@/lib/hr/employeeDocumentStorage');
    const store = createEmployeeHrDocumentStore({
      storeId: 'store_employeehr',
      token: 'vercel_blob_rw_employeehr_secret',
    });

    expect(store.provider).toBe('vercel-blob-private');
  });

  it('fails closed when employee-document credentials are absent', async () => {
    delete process.env.HR_EMPLOYEE_DOC_BLOB_STORE_ID;
    delete process.env.HR_EMPLOYEE_DOC_BLOB_READ_WRITE_TOKEN;

    const mod = await import('@/lib/hr/employeeDocumentStorage');

    expect(() => mod.createEmployeeHrDocumentStore())
      .toThrow(mod.EmployeeHrDocumentConfigurationError);
  });

  it('never falls back to restricted HR, Data Hub, or commercial Blob credentials', async () => {
    delete process.env.HR_EMPLOYEE_DOC_BLOB_STORE_ID;
    delete process.env.HR_EMPLOYEE_DOC_BLOB_READ_WRITE_TOKEN;

    process.env.HR_RESTRICTED_BLOB_STORE_ID = 'store_restricted_hr';
    process.env.HR_RESTRICTED_BLOB_READ_WRITE_TOKEN = 'restricted-token';
    process.env.DATAHUB_BLOB_STORE_ID = 'store_datahub';
    process.env.DATAHUB_BLOB_READ_WRITE_TOKEN = 'datahub-token';
    process.env.COMMERCIAL_BLOB_STORE_ID = 'store_commercial';
    process.env.COMMERCIAL_BLOB_READ_WRITE_TOKEN = 'commercial-token';

    const mod = await import('@/lib/hr/employeeDocumentStorage');

    expect(() => mod.createEmployeeHrDocumentStore())
      .toThrow(mod.EmployeeHrDocumentConfigurationError);
  });

  it('builds a deterministic tenant/person/document/version key without filename material', async () => {
    const { buildEmployeeHrDocumentVersionKey } =
      await import('@/lib/hr/employeeDocumentStorage');

    const key = buildEmployeeHrDocumentVersionKey(
      'org-a',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    );

    expect(key).toBe(
      'org_org-a/hr_employee_11111111-1111-4111-8111-111111111111/' +
      'document_22222222-2222-4222-8222-222222222222/' +
      'version_33333333-3333-4333-8333-333333333333',
    );
    expect(key).not.toContain('.pdf');
    expect(key).not.toContain('certificate');
  });

  it('rejects path-like or unsafe key components', async () => {
    const { buildEmployeeHrDocumentVersionKey } =
      await import('@/lib/hr/employeeDocumentStorage');

    expect(() => buildEmployeeHrDocumentVersionKey(
      '../org-a',
      'person',
      'document',
      'version',
    )).toThrow(/organisationId/);

    expect(() => buildEmployeeHrDocumentVersionKey(
      'org-a',
      'person/id',
      'document',
      'version',
    )).toThrow(/personId/);
  });
});
