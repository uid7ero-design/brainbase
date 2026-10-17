import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Phase 3E.2R — app/api/cron/ticket-email-recovery/route.ts. Mirrors
// tests/containment/cronSync.test.ts's own established pattern exactly
// (same CRON_SECRET/Bearer/secureCompare auth convention, same
// save-and-restore-env-var discipline) for the new route.

const runTicketEmailRecoveryMock = vi.fn();
vi.mock('@/lib/events/ticketEmailRecovery', () => ({
  runTicketEmailRecovery: () => runTicketEmailRecoveryMock(),
}));

// Phase 5B — the same route also runs the lifecycle-notification
// executor (lib/events/notificationRecovery.ts); mocked here so this
// file keeps proving the ROUTE's own auth/shape contract only.
const runNotificationRecoveryMock = vi.fn();
vi.mock('@/lib/events/notificationRecovery', () => ({
  runNotificationRecovery: () => runNotificationRecoveryMock(),
}));

const SAMPLE_NOTIFICATION_SUMMARY = {
  considered: 2, claimed: 1, sent: 1, retryable_failed: 0, terminal_failed: 0,
  not_claimed: 1, stale_exhausted_swept: 0, reminders_scheduled: 0, reminders_expired: 0,
  deferred_time_budget: 0, duration_ms: 7,
};

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
    runNotificationRecoveryMock.mockReset();
    runNotificationRecoveryMock.mockResolvedValue(SAMPLE_NOTIFICATION_SUMMARY);
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
    runNotificationRecoveryMock.mockReset().mockResolvedValue(SAMPLE_NOTIFICATION_SUMMARY);
  });

  it('200 response body is the ticket-email executor\'s own summary object, unmodified at the top level, plus the nested notification summary (Phase 5B)', async () => {
    const res = await GET(cronRequest('Bearer correct-secret'));
    const data = await res.json();
    expect(data).toEqual({ ...SAMPLE_SUMMARY, notifications: SAMPLE_NOTIFICATION_SUMMARY });
  });

  it('response contains only the 8 documented ticket-email counters plus the nested notifications summary — no identifier arrays, no email, no token, no error internals', async () => {
    const res = await GET(cronRequest('Bearer correct-secret'));
    const data = await res.json();
    expect(Object.keys(data).sort()).toEqual([
      'claimed', 'considered', 'duration_ms', 'not_claimed', 'notifications', 'retryable_failed',
      'sent', 'stale_exhausted_swept', 'terminal_failed',
    ]);
    expect(Object.keys(data.notifications).sort()).toEqual([
      'claimed', 'considered', 'deferred_time_budget', 'duration_ms', 'not_claimed', 'reminders_expired',
      'reminders_scheduled', 'retryable_failed', 'sent', 'stale_exhausted_swept', 'terminal_failed',
    ]);
  });

  it('runs the lifecycle-notification executor exactly once per run, after the ticket-email executor, under the same secret (no second cron) — Phase 5B', async () => {
    const res = await GET(cronRequest('Bearer correct-secret'));
    expect(res.status).toBe(200);
    expect(runTicketEmailRecoveryMock).toHaveBeenCalledTimes(1);
    expect(runNotificationRecoveryMock).toHaveBeenCalledTimes(1);
    expect(runNotificationRecoveryMock.mock.invocationCallOrder[0]).toBeGreaterThan(runTicketEmailRecoveryMock.mock.invocationCallOrder[0]);
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
