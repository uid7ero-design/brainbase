import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runBatchMock = vi.fn();

vi.mock('@/lib/hr/employeeDocumentReminderBatchExecutor', () => ({
  runEmployeeDocumentReminderBatch: (...args: unknown[]) => runBatchMock(...args),
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

describe('HR-7E5G employee document reminder cron route', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-test-secret';
    runBatchMock.mockResolvedValue(SUMMARY);
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
  });

  it('rejects a missing bearer token', async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(runBatchMock).not.toHaveBeenCalled();
  });

  it('rejects an incorrect bearer token', async () => {
    const response = await GET(request('Bearer wrong-secret'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(runBatchMock).not.toHaveBeenCalled();
  });

  it('runs exactly one batch for the correct bearer token and returns aggregate counts only', async () => {
    const response = await GET(request('Bearer cron-test-secret'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(SUMMARY);
    expect(runBatchMock).toHaveBeenCalledTimes(1);
    expect(runBatchMock).toHaveBeenCalledWith();

    const body = JSON.stringify(SUMMARY);
    expect(body).not.toContain('organisationId');
    expect(body).not.toContain('recipient');
    expect(body).not.toContain('documentVersion');
    expect(body).not.toContain('email');
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
  });
});
