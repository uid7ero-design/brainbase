import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Phase 3E.2R — app/api/cron/ticket-email-recovery/route.ts. Mirrors
// tests/containment/cronSync.test.ts's own established pattern exactly
// (same CRON_SECRET/Bearer/secureCompare auth convention, same
// save-and-restore-env-var discipline) for the new route.

const runTicketEmailRecoveryMock = vi.fn();
vi.mock('@/lib/events/ticketEmailRecovery', () => ({
  runTicketEmailRecovery: () => runTicketEmailRecoveryMock(),
}));

const { GET } = await import('@/app/api/cron/ticket-email-recovery/route');

function cronRequest(authHeader?: string): Request {
  return new Request('http://localhost/api/cron/ticket-email-recovery', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

const SAMPLE_SUMMARY = {
  considered: 3, claimed: 2, sent: 1, retryable_failed: 1, terminal_failed: 0,
  not_claimed: 1, stale_exhausted_swept: 0, duration_ms: 42,
};

describe('GET /api/cron/ticket-email-recovery — fails closed', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    runTicketEmailRecoveryMock.mockReset();
    runTicketEmailRecoveryMock.mockResolvedValue(SAMPLE_SUMMARY);
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it('refuses every request when CRON_SECRET is not configured (missing environment secret)', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(cronRequest('Bearer anything'));
    expect(res.status).toBe(401);
    expect(runTicketEmailRecoveryMock).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header at all (missing request credential)', async () => {
    process.env.CRON_SECRET = 'correct-secret';
    const res = await GET(cronRequest());
    expect(res.status).toBe(401);
    expect(runTicketEmailRecoveryMock).not.toHaveBeenCalled();
  });

  it('rejects a request with an incorrect credential', async () => {
    process.env.CRON_SECRET = 'correct-secret';
    const res = await GET(cronRequest('Bearer wrong-secret'));
    expect(res.status).toBe(401);
    expect(runTicketEmailRecoveryMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed Bearer value (missing "Bearer " prefix, correct secret as raw value)', async () => {
    process.env.CRON_SECRET = 'correct-secret';
    const res = await GET(cronRequest('correct-secret'));
    expect(res.status).toBe(401);
    expect(runTicketEmailRecoveryMock).not.toHaveBeenCalled();
  });

  it('runs the recovery executor exactly once for a valid credential', async () => {
    process.env.CRON_SECRET = 'correct-secret';
    const res = await GET(cronRequest('Bearer correct-secret'));
    expect(res.status).toBe(200);
    expect(runTicketEmailRecoveryMock).toHaveBeenCalledTimes(1);
  });

  it('an unauthorized request never invokes the executor, under any of the above conditions', async () => {
    process.env.CRON_SECRET = 'correct-secret';
    await GET(cronRequest());
    await GET(cronRequest('Bearer wrong'));
    await GET(cronRequest('correct-secret'));
    expect(runTicketEmailRecoveryMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/ticket-email-recovery — response shape', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'correct-secret';
    runTicketEmailRecoveryMock.mockReset().mockResolvedValue(SAMPLE_SUMMARY);
  });

  it('200 response body is exactly the executor\'s own summary object, unmodified', async () => {
    const res = await GET(cronRequest('Bearer correct-secret'));
    const data = await res.json();
    expect(data).toEqual(SAMPLE_SUMMARY);
  });

  it('response contains only the 8 documented counters — no identifier arrays, no email, no token, no error internals', async () => {
    const res = await GET(cronRequest('Bearer correct-secret'));
    const data = await res.json();
    expect(Object.keys(data).sort()).toEqual([
      'claimed', 'considered', 'duration_ms', 'not_claimed', 'retryable_failed',
      'sent', 'stale_exhausted_swept', 'terminal_failed',
    ]);
  });

  it('the CRON_SECRET value never appears anywhere in the response body', async () => {
    const res = await GET(cronRequest('Bearer correct-secret'));
    const text = await res.text();
    expect(text).not.toContain('correct-secret');
  });

  it('an infrastructure failure (executor throws) returns 500 with a generic error, never the raw error message/stack', async () => {
    runTicketEmailRecoveryMock.mockRejectedValue(new Error('connection reset: password=hunter2 at db.internal:5432'));
    const res = await GET(cronRequest('Bearer correct-secret'));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('db.internal');
    expect(text).not.toContain('connection reset');
  });

  it('does not return a 200 when the executor could not actually run (infrastructure failure propagates to a non-2xx)', async () => {
    runTicketEmailRecoveryMock.mockRejectedValue(new Error('db unreachable'));
    const res = await GET(cronRequest('Bearer correct-secret'));
    expect(res.status).not.toBe(200);
  });
});
