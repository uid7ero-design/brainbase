import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { OrgSession } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest;
}

function jsonRequest(url: string, body: unknown): NextRequest {
  return asNextRequest(new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function deleteRequest(url: string): NextRequest {
  return asNextRequest(new Request(url, { method: 'DELETE' }));
}

const requireSessionMock = vi.fn();
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>();
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) };
});

const requireHrCapabilityMock = vi.fn();
vi.mock('@/lib/hr/capability', () => ({
  requireHrCapability: (...args: unknown[]) => requireHrCapabilityMock(...args),
}));

const resolveHrAccessContextMock = vi.fn();
vi.mock('@/lib/hr/context', () => ({
  resolveHrAccessContext: (...args: unknown[]) => resolveHrAccessContextMock(...args),
}));

const grantMock = vi.fn();
const revokeMock = vi.fn();
vi.mock('@/lib/hr/restrictedAccessMutations', () => ({
  grantRestrictedCaseAccess: (...args: unknown[]) => grantMock(...args),
  revokeRestrictedCaseAccess: (...args: unknown[]) => revokeMock(...args),
}));

const { POST } = await import('@/app/api/hr/restricted-cases/[id]/access/route');
const { DELETE } = await import('@/app/api/hr/restricted-cases/[id]/access/[userId]/route');

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const SESSION: OrgSession = {
  userId: 'hr-admin',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'manager',
  name: 'HR Admin',
};
const SUPER_ADMIN: OrgSession = {
  userId: 'founder',
  organisationId: 'org-a',
  homeOrganisationId: 'founder-org',
  role: 'super_admin',
  name: 'Founder',
};
const HR_ADMIN_CTX = {
  organisationId: 'org-a',
  selfPersonId: null,
  isHrAdministrator: true,
  hasRestrictedHrAccess: false,
};
const NOBODY_CTX = {
  organisationId: 'org-a',
  selfPersonId: null,
  isHrAdministrator: false,
  hasRestrictedHrAccess: false,
};

beforeEach(() => {
  requireSessionMock.mockReset();
  requireHrCapabilityMock.mockReset();
  resolveHrAccessContextMock.mockReset();
  grantMock.mockReset();
  revokeMock.mockReset();
  requireSessionMock.mockResolvedValue(SESSION);
  requireHrCapabilityMock.mockResolvedValue({ key: 'people', config: {} });
  resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
});

describe('POST /api/hr/restricted-cases/[id]/access', () => {
  it('returns the locked 401 contract when unauthenticated', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await POST(jsonRequest('http://localhost/x', { user_id: 'target' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized.' });
    expect(grantMock).not.toHaveBeenCalled();
  });

  it('returns 503 when People capability cannot be verified', async () => {
    requireHrCapabilityMock.mockRejectedValue(new CapabilityDatabaseError());
    const res = await POST(jsonRequest('http://localhost/x', { user_id: 'target' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Unable to verify People access.' });
    expect(grantMock).not.toHaveBeenCalled();
  });

  it('returns locked 403 for a caller without restricted grant-management authority', async () => {
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const res = await POST(jsonRequest('http://localhost/x', { user_id: 'target' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden.' });
    expect(grantMock).not.toHaveBeenCalled();
  });

  it('collapses malformed case ids to the canonical 404 before mutation', async () => {
    const res = await POST(jsonRequest('http://localhost/x', { user_id: 'target' }), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Restricted HR case not found.' });
    expect(grantMock).not.toHaveBeenCalled();
  });

  it('rejects missing and client-authority fields with locked 400 contracts', async () => {
    const missing = await POST(jsonRequest('http://localhost/x', {}), { params: Promise.resolve({ id: CASE_ID }) });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'user_id is required.' });

    const injected = await POST(jsonRequest('http://localhost/x', { user_id: 'target', granted_by: 'attacker' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(injected.status).toBe(400);
    expect(await injected.json()).toEqual({ error: 'Unknown or unsupported field: granted_by' });
    expect(grantMock).not.toHaveBeenCalled();
  });

  it('returns 201 for a newly-created grant and derives actor/org from session', async () => {
    grantMock.mockResolvedValue({ outcome: 'granted', grantId: 'grant-1', grantedAt: '2026-09-25T05:00:00Z' });
    const req = jsonRequest('http://localhost/x', { user_id: ' target-user ' });
    const res = await POST(req, { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ granted: true, already_granted: false, user_id: 'target-user' });
    expect(grantMock).toHaveBeenCalledWith(expect.objectContaining({
      caseId: CASE_ID,
      targetUserId: 'target-user',
      actor: expect.objectContaining({ organisationId: 'org-a', userId: 'hr-admin' }),
    }));
  });

  it('returns idempotent 200 for an existing live grant', async () => {
    grantMock.mockResolvedValue({ outcome: 'already_granted' });
    const res = await POST(jsonRequest('http://localhost/x', { user_id: 'target' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ granted: true, already_granted: true, user_id: 'target' });
  });

  it('collapses nonexistent/wrong-org case and target ineligibility to their locked errors', async () => {
    grantMock.mockResolvedValueOnce({ outcome: 'case_not_found' });
    const missingCase = await POST(jsonRequest('http://localhost/x', { user_id: 'target' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(missingCase.status).toBe(404);
    expect(await missingCase.json()).toEqual({ error: 'Restricted HR case not found.' });

    grantMock.mockResolvedValueOnce({ outcome: 'target_not_eligible' });
    const badTarget = await POST(jsonRequest('http://localhost/x', { user_id: 'target' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(badTarget.status).toBe(400);
    expect(await badTarget.json()).toEqual({
      error: 'User is not eligible for restricted HR access.',
      code: 'restricted_hr_user_not_eligible',
    });
  });

  it('supports super_admin org override without substituting home org', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN);
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    grantMock.mockResolvedValue({ outcome: 'already_granted' });
    await POST(jsonRequest('http://localhost/x', { user_id: 'target' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(grantMock).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({ organisationId: 'org-a', userId: 'founder' }),
    }));
    expect(JSON.stringify(grantMock.mock.calls)).not.toContain('founder-org');
  });

  it('maps unexpected mutation failures to the generic locked 500', async () => {
    grantMock.mockRejectedValue(new Error('database exploded'));
    const res = await POST(jsonRequest('http://localhost/x', { user_id: 'target' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Could not grant restricted HR access.' });
  });
});

describe('DELETE /api/hr/restricted-cases/[id]/access/[userId]', () => {
  it('returns locked 401/403 contracts before mutation', async () => {
    requireSessionMock.mockRejectedValueOnce(new Error('Unauthorized'));
    const unauth = await DELETE(deleteRequest('http://localhost/x'), { params: Promise.resolve({ id: CASE_ID, userId: 'target' }) });
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toEqual({ error: 'Unauthorized.' });

    requireSessionMock.mockResolvedValue(SESSION);
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const denied = await DELETE(deleteRequest('http://localhost/x'), { params: Promise.resolve({ id: CASE_ID, userId: 'target' }) });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'Forbidden.' });
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it('collapses malformed case ids to canonical 404', async () => {
    const res = await DELETE(deleteRequest('http://localhost/x'), { params: Promise.resolve({ id: 'bad-id', userId: 'target' }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Restricted HR case not found.' });
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it('returns actual revoke and idempotent already-revoked responses', async () => {
    revokeMock.mockResolvedValueOnce({ outcome: 'revoked', grantId: 'grant-1', revokedAt: '2026-09-25T07:00:00Z' });
    const changed = await DELETE(deleteRequest('http://localhost/x'), { params: Promise.resolve({ id: CASE_ID, userId: 'target-user' }) });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ revoked: true, already_revoked: false, user_id: 'target-user' });

    revokeMock.mockResolvedValueOnce({ outcome: 'already_revoked' });
    const idem = await DELETE(deleteRequest('http://localhost/x'), { params: Promise.resolve({ id: CASE_ID, userId: 'target-user' }) });
    expect(idem.status).toBe(200);
    expect(await idem.json()).toEqual({ revoked: true, already_revoked: true, user_id: 'target-user' });
  });

  it('does not require target eligibility for revoke and passes target directly to mutation helper', async () => {
    revokeMock.mockResolvedValue({ outcome: 'already_revoked' });
    await DELETE(deleteRequest('http://localhost/x'), { params: Promise.resolve({ id: CASE_ID, userId: 'inactive-target' }) });
    expect(revokeMock).toHaveBeenCalledWith(expect.objectContaining({ targetUserId: 'inactive-target' }));
  });

  it('returns canonical 404 when the mutation helper cannot find the active-org case', async () => {
    revokeMock.mockResolvedValue({ outcome: 'case_not_found' });
    const res = await DELETE(deleteRequest('http://localhost/x'), { params: Promise.resolve({ id: CASE_ID, userId: 'target' }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Restricted HR case not found.' });
  });

  it('maps unexpected revoke failures to the generic locked 500', async () => {
    revokeMock.mockRejectedValue(new Error('database exploded'));
    const res = await DELETE(deleteRequest('http://localhost/x'), { params: Promise.resolve({ id: CASE_ID, userId: 'target' }) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Could not revoke restricted HR access.' });
  });
});
