import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runBatchMock = vi.fn();
const staleCountMock = vi.fn();

vi.mock('@/lib/hr/employeeDocumentReminderBatchExecutor', () => ({
  runEmployeeDocumentReminderBatch: (...args: unknown[]) => runBatchMock(...args),
}));

vi.mock('@/lib/hr/employeeDocumentReminderRecoveryVisibility', () => ({
  countStaleEmployeeDocumentReminderClaims: (...args: unknown[]) => staleCountMock(...args),
}));

const { GET } = await import(
  '@/app/api/cron/hr-employee-document-reminders/route'
);

const SUMMARY = {
  organisationsDiscovered: 2,
  organisationsProcessed: 2,
  organisationsFailed: 0,
  discovered: 3,
  claimed: 3,
  discoverySkipped: 0,
  sent: 2,
  failed: 1,
  ambiguous: 0,
  transitionSkipped: 0,
};

function request(auth?: string) {
  return new Request('https://brainbase.test/api/cron/hr-employee-document-reminders', {
    headers: auth ? { authorization: auth } : undefined,
  });
}

describe('HR employee document reminder cron route', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-test-secret';
    runBatchMock.mockResolvedValue(SUMMARY);
    staleCountMock.mockResolvedValue(2);
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalSecret;
    }
  });

  it('fails closed when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(runBatchMock).not.toHaveBeenCalled();
    expect(staleCountMock).not.toHaveBeenCalled();
  });

  it('rejects a missing bearer token', async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(runBatchMock).not.toHaveBeenCalled();
    expect(staleCountMock).not.toHaveBeenCalled();
  });

  it('rejects an incorrect bearer token', async () => {
    const response = await GET(request('Bearer wrong-secret'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(runBatchMock).not.toHaveBeenCalled();
    expect(staleCountMock).not.toHaveBeenCalled();
  });

  it('returns the batch summary plus only the aggregate stale CLAIMED count', async () => {
    const response = await GET(request('Bearer cron-test-secret'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ...SUMMARY,
      staleClaimed: 2,
    });
    expect(runBatchMock).toHaveBeenCalledTimes(1);
    expect(staleCountMock).toHaveBeenCalledTimes(1);
  });

  it('does not fail a completed reminder batch when stale-claim visibility is unavailable', async () => {
    staleCountMock.mockRejectedValueOnce(
      new Error('postgres://secret-user:secret-password@internal-host/private'),
    );

    const response = await GET(request('Bearer cron-test-secret'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ...SUMMARY,
      staleClaimed: null,
    });
    expect(JSON.stringify(body)).not.toContain('secret-password');
    expect(JSON.stringify(body)).not.toContain('internal-host');
  });

  it('returns a bounded generic 500 if the batch executor throws', async () => {
    runBatchMock.mockRejectedValueOnce(
      new Error('postgres://secret-user:secret-password@internal-host/private'),
    );

    const response = await GET(request('Bearer cron-test-secret'));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'Employee document reminder run failed.' });
    expect(JSON.stringify(body)).not.toContain('secret-password');
    expect(JSON.stringify(body)).not.toContain('internal-host');
    expect(staleCountMock).not.toHaveBeenCalled();
  });
});
