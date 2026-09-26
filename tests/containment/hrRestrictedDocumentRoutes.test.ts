import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { OrgSession } from '@/lib/org';
import { RawFileStoreError } from '@/lib/data-hub/storage/rawFileStore';

function request(method: string, body?: BodyInit): NextRequest {
  return new Request('http://localhost/x', { method, body }) as unknown as NextRequest;
}

const requireSessionMock = vi.fn();
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>();
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) };
});

const capabilityMock = vi.fn();
vi.mock('@/lib/hr/capability', () => ({ requireHrCapability: (...args: unknown[]) => capabilityMock(...args) }));

const requireCaseMock = vi.fn();
vi.mock('@/lib/hr/restrictedRoute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/restrictedRoute')>();
  return { ...actual, requireRestrictedCase: (...args: unknown[]) => requireCaseMock(...args) };
});

const readAuditMock = vi.fn();
vi.mock('@/lib/hr/auditLog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/auditLog')>();
  return { ...actual, logRestrictedHrReadEvent: (...args: unknown[]) => readAuditMock(...args) };
});

const listMock = vi.fn();
const uploadMock = vi.fn();
const getMock = vi.fn();
const downloadMock = vi.fn();
const softDeleteMock = vi.fn();
vi.mock('@/lib/hr/restrictedCaseDocuments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/restrictedCaseDocuments')>();
  return {
    ...actual,
    listRestrictedCaseDocuments: (...args: unknown[]) => listMock(...args),
    uploadRestrictedCaseDocument: (...args: unknown[]) => uploadMock(...args),
    getRestrictedCaseDocument: (...args: unknown[]) => getMock(...args),
    downloadRestrictedCaseDocumentBytes: (...args: unknown[]) => downloadMock(...args),
    softDeleteRestrictedCaseDocument: (...args: unknown[]) => softDeleteMock(...args),
  };
});

const collection = await import('@/app/api/hr/restricted-cases/[id]/documents/route');
const item = await import('@/app/api/hr/restricted-cases/[id]/documents/[documentId]/route');

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';
const SESSION: OrgSession = {
  userId: 'reader-user', organisationId: 'org-a', homeOrganisationId: 'org-a', role: 'manager', name: 'Reader',
};
const DOCUMENT = {
  id: DOC_ID,
  organisation_id: 'org-a',
  case_id: CASE_ID,
  uploaded_by: 'reader-user',
  original_filename: 'Sensitive Case File.pdf',
  content_type: 'application/pdf',
  byte_size: 3,
  storage_key: 'private/key/never-return',
  deleted_at: null,
  created_at: '2026-09-25T01:00:00Z',
};

beforeEach(() => {
  requireSessionMock.mockReset().mockResolvedValue(SESSION);
  capabilityMock.mockReset().mockResolvedValue({ key: 'people', config: {} });
  requireCaseMock.mockReset().mockResolvedValue({ ok: true, case: { id: CASE_ID } });
  readAuditMock.mockReset().mockResolvedValue(undefined);
  listMock.mockReset().mockResolvedValue([DOCUMENT]);
  uploadMock.mockReset();
  getMock.mockReset().mockResolvedValue(DOCUMENT);
  downloadMock.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
  softDeleteMock.mockReset().mockResolvedValue({ outcome: 'deleted', deletedAt: '2026-09-25T02:00:00Z' });
});

describe('restricted document collection route', () => {
  it('GET requires exact restricted-case read authorization, strictly audits each row, and never exposes storage_key', async () => {
    const res = await collection.GET(request('GET'), { params: Promise.resolve({ id: CASE_ID }) });
    expect(requireCaseMock).toHaveBeenCalledWith(SESSION, CASE_ID);
    expect(readAuditMock).toHaveBeenCalledTimes(1);
    expect(readAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'hr_restricted_case_document.read',
      resourceType: 'hr_restricted_case_document',
      resourceId: DOC_ID,
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.documents[0]).not.toHaveProperty('storage_key');
    expect(json.documents[0]).not.toHaveProperty('organisation_id');
    expect(json.documents[0].original_filename).toBe('Sensitive Case File.pdf');
  });

  it('GET fails closed without disclosure if strict read auditing fails', async () => {
    readAuditMock.mockRejectedValue(new Error('audit unavailable'));
    const res = await collection.GET(request('GET'), { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Unable to record restricted HR access.' });
  });

  it('POST requires the same exact read grant rather than HR-admin/participant status', async () => {
    requireCaseMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Restricted HR case not found.' }, { status: 404 }),
    });
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1])], 'x.pdf', { type: 'application/pdf' }));
    const res = await collection.POST(request('POST', form), { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(404);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('POST returns 201 for a private document and derives uploader/org from session', async () => {
    uploadMock.mockResolvedValue({
      outcome: 'created',
      document: {
        id: DOC_ID, case_id: CASE_ID, uploaded_by: 'reader-user', original_filename: 'x.pdf',
        content_type: 'application/pdf', byte_size: 1, deleted_at: null, created_at: 'x',
      },
    });
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1])], 'x.pdf', { type: 'application/pdf' }));
    const res = await collection.POST(request('POST', form), { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(201);
    expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({
      caseId: CASE_ID,
      actor: expect.objectContaining({ organisationId: 'org-a', userId: 'reader-user' }),
      originalFilename: 'x.pdf',
      contentType: 'application/pdf',
    }));
    expect(JSON.stringify(await res.json())).not.toContain('storage_key');
  });

  it('POST separates validation failures from private storage/provider failures', async () => {
    const makeForm = () => {
      const form = new FormData();
      form.set('file', new File([new Uint8Array([1])], 'x.pdf', { type: 'application/pdf' }));
      return form;
    };
    uploadMock.mockResolvedValueOnce({ outcome: 'invalid', error: 'File type is not allowed.' });
    const invalid = await collection.POST(request('POST', makeForm()), { params: Promise.resolve({ id: CASE_ID }) });
    expect(invalid.status).toBe(400);

    uploadMock.mockResolvedValueOnce({ outcome: 'storage_error' });
    const storage = await collection.POST(request('POST', makeForm()), { params: Promise.resolve({ id: CASE_ID }) });
    expect(storage.status).toBe(502);
    expect(await storage.json()).toEqual({ error: 'Could not store restricted HR document.' });
  });
});

describe('restricted document item route', () => {
  it('GET collapses malformed/missing/deleted document IDs to the same 404', async () => {
    const malformed = await item.GET(request('GET'), { params: Promise.resolve({ id: CASE_ID, documentId: 'bad' }) });
    expect(malformed.status).toBe(404);

    getMock.mockResolvedValue(null);
    const missing = await item.GET(request('GET'), { params: Promise.resolve({ id: CASE_ID, documentId: DOC_ID }) });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Restricted HR document not found.' });
  });

  it('GET writes the strict audit before private blob retrieval and serves no-store attachment bytes', async () => {
    const order: string[] = [];
    readAuditMock.mockImplementation(async () => { order.push('audit'); });
    downloadMock.mockImplementation(async () => { order.push('download'); return new Uint8Array([1, 2, 3]); });
    const res = await item.GET(request('GET'), { params: Promise.resolve({ id: CASE_ID, documentId: DOC_ID }) });
    expect(order).toEqual(['audit', 'download']);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('Sensitive Case File.pdf');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('GET fails closed on audit failure and never reads blob bytes', async () => {
    readAuditMock.mockRejectedValue(new Error('audit down'));
    const res = await item.GET(request('GET'), { params: Promise.resolve({ id: CASE_ID, documentId: DOC_ID }) });
    expect(res.status).toBe(503);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('GET converts a missing private blob into the same document 404', async () => {
    downloadMock.mockRejectedValue(new RawFileStoreError('NOT_FOUND', 'private key detail'));
    const res = await item.GET(request('GET'), { params: Promise.resolve({ id: CASE_ID, documentId: DOC_ID }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Restricted HR document not found.' });
  });

  it('DELETE requires exact case read auth and returns soft-delete metadata without storage internals', async () => {
    const res = await item.DELETE(request('DELETE'), { params: Promise.resolve({ id: CASE_ID, documentId: DOC_ID }) });
    expect(requireCaseMock).toHaveBeenCalledWith(SESSION, CASE_ID);
    expect(softDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
      caseId: CASE_ID,
      documentId: DOC_ID,
      actor: expect.objectContaining({ organisationId: 'org-a', userId: 'reader-user' }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, document_id: DOC_ID, deleted_at: '2026-09-25T02:00:00Z' });
  });

  it('DELETE is idempotent externally as canonical 404 once metadata is already soft-deleted', async () => {
    softDeleteMock.mockResolvedValue({ outcome: 'not_found' });
    const res = await item.DELETE(request('DELETE'), { params: Promise.resolve({ id: CASE_ID, documentId: DOC_ID }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Restricted HR document not found.' });
  });
});
