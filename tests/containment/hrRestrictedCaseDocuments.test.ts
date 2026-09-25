import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RawFileStoreError } from '@/lib/data-hub/storage/rawFileStore';

type Query = { text: string; values: unknown[] };
let dbResponses: unknown[][] = [];
let dbCalls: Query[] = [];
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  dbCalls.push({ text: strings.join('?'), values });
  return Promise.resolve(dbResponses.shift() ?? []);
});
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) =>
    (sqlMock as unknown as (...a: unknown[]) => unknown)(
      ...(args as [TemplateStringsArray, ...unknown[]]),
    ),
}));

const putMock = vi.fn();
const getMock = vi.fn();
const deleteMock = vi.fn();
const store = { provider: 'test', put: putMock, get: getMock, delete: deleteMock, head: vi.fn() };
vi.mock('@/lib/hr/restrictedDocumentStorage', () => ({
  createRestrictedHrDocumentStore: () => store,
  buildRestrictedHrDocumentKey: (org: string, caseId: string, docId: string) => `org_${org}/case_${caseId}/doc_${docId}`,
}));

const mod = await import('@/lib/hr/restrictedCaseDocuments');
const ACTOR = { organisationId: 'org-a', userId: 'reader-user' };
const CASE_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  dbResponses = [];
  dbCalls = [];
  sqlMock.mockClear();
  putMock.mockReset().mockResolvedValue({ key: 'k', provider: 'test', size: 3 });
  getMock.mockReset();
  deleteMock.mockReset().mockResolvedValue(undefined);
});

describe('restricted case document metadata/read boundary', () => {
  it('list and single lookup are scoped by active org + case and exclude soft-deleted rows', async () => {
    dbResponses = [[], []];
    await mod.listRestrictedCaseDocuments('org-a', CASE_ID);
    await mod.getRestrictedCaseDocument('org-a', CASE_ID, DOC_ID);
    expect(dbCalls[0].text).toContain('organisation_id = ?');
    expect(dbCalls[0].text).toContain('case_id = ?::uuid');
    expect(dbCalls[0].text).toContain('deleted_at IS NULL');
    expect(dbCalls[1].text).toContain('id = ?::uuid');
    expect(dbCalls[1].text).toContain('deleted_at IS NULL');
  });

  it('public projection never exposes organisation_id or storage_key', () => {
    const projected = mod.toPublicRestrictedCaseDocument({
      id: DOC_ID,
      organisation_id: 'org-a',
      case_id: CASE_ID,
      uploaded_by: 'reader-user',
      original_filename: 'secret.pdf',
      content_type: 'application/pdf',
      byte_size: 3,
      storage_key: 'private/key',
      deleted_at: null,
      created_at: 'x',
    });
    expect(projected).not.toHaveProperty('organisation_id');
    expect(projected).not.toHaveProperty('storage_key');
  });
});

describe('uploadRestrictedCaseDocument', () => {
  it('writes private bytes first, then metadata + audit atomically; audit redacts filename and omits storage key', async () => {
    dbResponses = [[{
      case_exists: true,
      id: DOC_ID,
      uploaded_by: 'reader-user',
      original_filename: 'secret.pdf',
      content_type: 'application/pdf',
      byte_size: 3,
      deleted_at: null,
      created_at: 'x',
      audit_written: true,
    }]];
    const result = await mod.uploadRestrictedCaseDocument({
      actor: ACTOR,
      caseId: CASE_ID,
      originalFilename: 'secret.pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(result.outcome).toBe('created');
    expect(putMock).toHaveBeenCalledTimes(1);
    const q = dbCalls[0];
    expect(q.text).toContain('INSERT INTO hr_restricted_case_documents');
    expect(q.text).toContain('INSERT INTO audit_logs');
    const auditJson = q.text.split('jsonb_build_object(')[1]?.split(')')[0] ?? '';
    expect(auditJson).toContain("'original_filename', '[redacted]'");
    expect(auditJson).not.toContain('storage_key');
  });

  it('validates type/size/empty input before storage', async () => {
    const invalid = await mod.uploadRestrictedCaseDocument({
      actor: ACTOR, caseId: CASE_ID, originalFilename: 'x.exe', contentType: 'application/x-msdownload', bytes: new Uint8Array([1]),
    });
    expect(invalid.outcome).toBe('invalid');
    expect(putMock).not.toHaveBeenCalled();
  });

  it('returns storage_error for provider failures without leaking provider details', async () => {
    putMock.mockRejectedValue(new RawFileStoreError('PROVIDER_FAILURE', 'secret provider/path detail'));
    const result = await mod.uploadRestrictedCaseDocument({
      actor: ACTOR, caseId: CASE_ID, originalFilename: 'x.pdf', contentType: 'application/pdf', bytes: new Uint8Array([1]),
    });
    expect(result).toEqual({ outcome: 'storage_error' });
  });

  it('best-effort deletes an orphan blob if the active-org case disappeared before metadata insert', async () => {
    dbResponses = [[{
      case_exists: false, id: null, uploaded_by: null, original_filename: null,
      content_type: null, byte_size: null, deleted_at: null, created_at: null, audit_written: false,
    }]];
    const result = await mod.uploadRestrictedCaseDocument({
      actor: ACTOR, caseId: CASE_ID, originalFilename: 'x.pdf', contentType: 'application/pdf', bytes: new Uint8Array([1]),
    });
    expect(result).toEqual({ outcome: 'case_not_found' });
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it('rolls back DB mutation on audit failure and compensates the already-written blob', async () => {
    sqlMock.mockImplementationOnce(() => Promise.reject(new Error('audit insert failed')));
    await expect(mod.uploadRestrictedCaseDocument({
      actor: ACTOR, caseId: CASE_ID, originalFilename: 'x.pdf', contentType: 'application/pdf', bytes: new Uint8Array([1]),
    })).rejects.toThrow('audit insert failed');
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});

describe('download/delete lifecycle', () => {
  it('downloads only through the private store with a hard byte ceiling', async () => {
    getMock.mockResolvedValue({ metadata: { provider: 'test', size: 3 }, body: new Uint8Array([1, 2, 3]) });
    const doc = {
      id: DOC_ID, organisation_id: 'org-a', case_id: CASE_ID, uploaded_by: 'u', original_filename: 'x.pdf',
      content_type: 'application/pdf', byte_size: 3, storage_key: 'private/key', deleted_at: null, created_at: 'x',
    };
    await mod.downloadRestrictedCaseDocumentBytes(doc);
    expect(getMock).toHaveBeenCalledWith('private/key', { maxBytes: mod.MAX_RESTRICTED_DOCUMENT_BYTES });
  });

  it('soft-deletes metadata + audit atomically, then best-effort deletes blob without hard-deleting metadata', async () => {
    dbResponses = [[{
      case_exists: true, document_id: DOC_ID, storage_key: 'private/key', deleted_at: 'deleted-time', audit_written: true,
    }]];
    const result = await mod.softDeleteRestrictedCaseDocument({ actor: ACTOR, caseId: CASE_ID, documentId: DOC_ID });
    expect(result).toEqual({ outcome: 'deleted', deletedAt: 'deleted-time' });
    const q = dbCalls[0].text;
    expect(q).toContain('UPDATE hr_restricted_case_documents');
    expect(q).toContain('SET deleted_at = NOW()');
    expect(q).not.toMatch(/DELETE\s+FROM\s+hr_restricted_case_documents/i);
    expect(q).toContain('INSERT INTO audit_logs');
    const auditJson = q.split('jsonb_build_object(')[1]?.split(')')[0] ?? '';
    expect(auditJson).toContain("'original_filename', '[redacted]'");
    expect(auditJson).not.toContain('storage_key');
    expect(deleteMock).toHaveBeenCalledWith('private/key');
  });

  it('does not fail the already-authoritative soft delete when blob cleanup fails', async () => {
    dbResponses = [[{
      case_exists: true, document_id: DOC_ID, storage_key: 'private/key', deleted_at: 'deleted-time', audit_written: true,
    }]];
    deleteMock.mockRejectedValue(new Error('provider down'));
    await expect(mod.softDeleteRestrictedCaseDocument({ actor: ACTOR, caseId: CASE_ID, documentId: DOC_ID }))
      .resolves.toEqual({ outcome: 'deleted', deletedAt: 'deleted-time' });
  });
});
