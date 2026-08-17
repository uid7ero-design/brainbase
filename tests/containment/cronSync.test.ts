import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const runAllSyncsMock = vi.fn();
vi.mock('@/lib/integrations/syncEngine', () => ({
  runAllSyncs: () => runAllSyncsMock(),
}));

const { GET } = await import('@/app/api/cron/sync/route');

function cronRequest(authHeader?: string): Request {
  return new Request('http://localhost/api/cron/sync', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe('GET /api/cron/sync — fails closed', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    runAllSyncsMock.mockReset();
    runAllSyncsMock.mockResolvedValue({ total: 3, errors: 0 });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it('refuses every request when CRON_SECRET is not configured (missing environment secret)', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(cronRequest('Bearer anything'));
    expect(res.status).toBe(401);
    expect(runAllSyncsMock).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header at all (missing request credential)', async () => {
    process.env.CRON_SECRET = 'correct-secret';
    const res = await GET(cronRequest());
    expect(res.status).toBe(401);
    expect(runAllSyncsMock).not.toHaveBeenCalled();
  });

  it('rejects a request with an incorrect credential', async () => {
    process.env.CRON_SECRET = 'correct-secret';
    const res = await GET(cronRequest('Bearer wrong-secret'));
    expect(res.status).toBe(401);
    expect(runAllSyncsMock).not.toHaveBeenCalled();
  });

  it('runs the sync for a valid credential', async () => {
    process.env.CRON_SECRET = 'correct-secret';
    const res = await GET(cronRequest('Bearer correct-secret'));
    expect(res.status).toBe(200);
    expect(runAllSyncsMock).toHaveBeenCalledTimes(1);
    const data = await res.json();
    expect(data).toMatchObject({ success: true, total: 3, errors: 0 });
  });
});
