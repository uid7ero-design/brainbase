import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encrypt } from '@/lib/social/crypto';

const requireSessionMock = vi.fn();
vi.mock('@/lib/org', () => ({
  requireSession: () => requireSessionMock(),
}));

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({ default: sqlMock }));

const { GET } = await import('@/app/api/instagram/feed/route');

describe('GET /api/instagram/feed — legacy plaintext read compatibility', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    requireSessionMock.mockReset();
    sqlMock.mockReset();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('denies an anonymous caller', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('decrypts a newly-encrypted token before calling the Graph API (never sends ciphertext as the bearer token)', async () => {
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'A' });
    const REAL_TOKEN = 'REAL-BEARER-TOKEN';
    const ciphertext = encrypt(REAL_TOKEN);
    sqlMock.mockResolvedValueOnce([{ access_token: ciphertext, instagram_account_id: 'ig123', platform_username: 'user1' }]);

    let capturedUrl = '';
    global.fetch = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ data: [] }));
    }) as unknown as typeof fetch;

    const res = await GET();
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain(`access_token=${REAL_TOKEN}`);
    expect(capturedUrl).not.toContain(encodeURIComponent(ciphertext));
  });

  it('falls back to using a legacy plaintext row as-is (pre-existing rows keep working)', async () => {
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'A' });
    const LEGACY_PLAINTEXT_TOKEN = 'LEGACY-PLAINTEXT-META-TOKEN-no-colons-here';
    sqlMock.mockResolvedValueOnce([{ access_token: LEGACY_PLAINTEXT_TOKEN, instagram_account_id: 'ig123', platform_username: 'user1' }]);

    let capturedUrl = '';
    global.fetch = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ data: [] }));
    }) as unknown as typeof fetch;

    const res = await GET();
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain(`access_token=${LEGACY_PLAINTEXT_TOKEN}`);
  });

  it('reports not connected when no row exists for the organisation', async () => {
    requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'A' });
    sqlMock.mockResolvedValueOnce([]);
    const res = await GET();
    const data = await res.json();
    expect(data).toEqual({ connected: false });
  });
});
