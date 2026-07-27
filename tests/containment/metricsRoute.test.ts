import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const requireSessionMock = vi.fn();
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>();
  return { ...actual, requireSession: () => requireSessionMock() };
});

// Force the SSRF guard's DNS resolution through a controllable mock instead
// of ever performing a real lookup.
const lookupMock = vi.fn();
vi.mock('dns', () => ({ promises: { lookup: (...args: unknown[]) => lookupMock(...args) } }));

const { POST } = await import('@/app/api/metrics/route');

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/metrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/metrics', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    requireSessionMock.mockReset();
    lookupMock.mockReset();
    delete process.env.METRICS_ALLOWED_HOSTS;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('denies anonymous callers with 401 before touching the network', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await POST(jsonRequest({ url: 'https://example.com/x' }));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks a destination not on the configured allowlist', async () => {
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'A' });
    process.env.METRICS_ALLOWED_HOSTS = 'example.com';
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await POST(jsonRequest({ url: 'https://not-allowed.test/x' }));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks an allowlisted hostname that resolves to a private address', async () => {
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'A' });
    process.env.METRICS_ALLOWED_HOSTS = 'internal-status.example.com';
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await POST(jsonRequest({ url: 'https://internal-status.example.com/x' }));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks when the allowlist is empty (fails closed)', async () => {
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'A' });
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await POST(jsonRequest({ url: 'https://example.com/x' }));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows an approved public hostname and returns its JSON value', async () => {
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'A' });
    process.env.METRICS_ALLOWED_HOSTS = 'example.com';
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    global.fetch = vi.fn(async () => new Response(JSON.stringify({ value: 42 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    const res = await POST(jsonRequest({ url: 'https://example.com/metrics', path: 'value' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.value).toBe('42');
  });

  it('rejects a non-JSON content-type response', async () => {
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'A' });
    process.env.METRICS_ALLOWED_HOSTS = 'example.com';
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    global.fetch = vi.fn(async () => new Response('<html>not json</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as unknown as typeof fetch;

    const res = await POST(jsonRequest({ url: 'https://example.com/metrics' }));
    expect(res.status).toBe(502);
  });

  it('rejects an oversized response body (streamed cap, not just Content-Length)', async () => {
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'A' });
    process.env.METRICS_ALLOWED_HOSTS = 'example.com';
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    // No Content-Length header at all — the cap must still be enforced by
    // counting streamed bytes as they arrive.
    const oversized = 'x'.repeat(300 * 1024);
    global.fetch = vi.fn(async () => new Response(oversized, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    const res = await POST(jsonRequest({ url: 'https://example.com/metrics' }));
    expect(res.status).toBe(502);
  });

  it('disables automatic redirect-following on the upstream fetch', async () => {
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'A' });
    process.env.METRICS_ALLOWED_HOSTS = 'example.com';
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ value: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await POST(jsonRequest({ url: 'https://example.com/metrics' }));
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/metrics', expect.objectContaining({ redirect: 'error' }));
  });

  it('surfaces a redirect response from fetch (redirect: "error") as a safe upstream failure', async () => {
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'A' });
    process.env.METRICS_ALLOWED_HOSTS = 'example.com';
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    global.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed: redirect mode is error');
    }) as unknown as typeof fetch;

    const res = await POST(jsonRequest({ url: 'https://example.com/metrics' }));
    expect(res.status).toBe(502);
  });

  it('rejects an invalid scheme before any network call', async () => {
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'A' });
    process.env.METRICS_ALLOWED_HOSTS = 'example.com';
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await POST(jsonRequest({ url: 'file:///etc/passwd' }));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
