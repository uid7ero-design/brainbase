import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const getAuthSessionMock = vi.fn();
vi.mock('@/lib/authSession', () => ({
  getAuthSession: () => getAuthSessionMock(),
}));

const { POST } = await import('@/app/api/hlna/run/route');

function jsonRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/hlna/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('POST /api/hlna/run — server-side organisation stamping', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    getAuthSessionMock.mockReset();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('denies anonymous callers with 401 before forwarding anything to the backend', async () => {
    getAuthSessionMock.mockRejectedValue(new Error('Unauthorized'));
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await POST(jsonRequest({ query: 'hello', organisationId: 'attacker-org' }));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('replaces a malicious client-supplied organisationId with the authenticated organisation ID', async () => {
    getAuthSessionMock.mockResolvedValue({
      userId: 'user-1', organisationId: 'real-org-id', role: 'viewer', name: 'A', email: 'a@x.com',
    });

    let capturedBody: Record<string, unknown> | null = null;
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    await POST(jsonRequest({
      query: 'hello',
      organisationId: 'attacker-org-id',
      organisation_id: 'attacker-org-id',
      orgId: 'attacker-org-id',
    }));

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.organisationId).toBe('real-org-id');
    expect(capturedBody!.organisation_id).toBe('real-org-id');
    expect(capturedBody!.orgId).toBeUndefined();
    // Never the attacker-supplied value, under any alias.
    expect(Object.values(capturedBody!)).not.toContain('attacker-org-id');
  });

  it('stamps the authenticated org even when the client sends no org id at all', async () => {
    getAuthSessionMock.mockResolvedValue({
      userId: 'user-2', organisationId: 'real-org-id-2', role: 'viewer', name: 'B', email: 'b@x.com',
    });

    let capturedBody: Record<string, unknown> | null = null;
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    await POST(jsonRequest({ query: 'hello' }));

    expect(capturedBody!.organisationId).toBe('real-org-id-2');
  });
});
