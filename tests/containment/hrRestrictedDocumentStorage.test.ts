import { afterEach, describe, expect, it } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('restricted HR document storage composition', () => {
  it('uses an explicit private-store credential pair and never falls back to another domain store', async () => {
    process.env.HR_RESTRICTED_BLOB_STORE_ID = 'store_hrstore';
    process.env.HR_RESTRICTED_BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_hrstore_secret';
    process.env.COMMERCIAL_BLOB_STORE_ID = 'store_commercial';
    process.env.DATAHUB_BLOB_STORE_ID = 'store_datahub';

    const { createRestrictedHrDocumentStore } = await import('@/lib/hr/restrictedDocumentStorage');
    const store = createRestrictedHrDocumentStore({
      storeId: 'store_hrstore',
      token: 'vercel_blob_rw_hrstore_secret',
    });
    expect(store.provider).toBe('vercel-blob-private');
  });

  it('fails closed when restricted-HR credentials are absent', async () => {
    delete process.env.HR_RESTRICTED_BLOB_STORE_ID;
    delete process.env.HR_RESTRICTED_BLOB_READ_WRITE_TOKEN;
    const mod = await import('@/lib/hr/restrictedDocumentStorage');
    expect(() => mod.createRestrictedHrDocumentStore()).toThrow(mod.RestrictedHrDocumentConfigurationError);
  });

  it('builds a deterministic tenant/case/document key without filename material', async () => {
    const { buildRestrictedHrDocumentKey } = await import('@/lib/hr/restrictedDocumentStorage');
    const key = buildRestrictedHrDocumentKey(
      'org-a',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(key).toBe(
      'org_org-a/hr_restricted_case_11111111-1111-4111-8111-111111111111/document_22222222-2222-4222-8222-222222222222',
    );
    expect(key).not.toContain('.pdf');
  });
});
