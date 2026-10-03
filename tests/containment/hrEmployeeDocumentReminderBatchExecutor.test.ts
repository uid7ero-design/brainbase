import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();
const processMock = vi.fn();
const transportFactoryMock = vi.fn();

vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}));

vi.mock('@/lib/hr/employeeDocumentReminderWorker', () => ({
  processDueEmployeeDocumentReminders: (...args: unknown[]) => processMock(...args),
}));

vi.mock('@/lib/hr/employeeDocumentReminderEmailTransport', () => ({
  createEmployeeDocumentReminderEmailTransport: (...args: unknown[]) =>
    transportFactoryMock(...args),
}));

const { runEmployeeDocumentReminderBatch } = await import(
  '@/lib/hr/employeeDocumentReminderBatchExecutor'
);

const EMPTY_RESULT = {
  discovered: 0,
  claimed: 0,
  discoverySkipped: 0,
  sent: 0,
  failed: 0,
  ambiguous: 0,
  transitionSkipped: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  sqlMock.mockResolvedValue([]);
  processMock.mockResolvedValue(EMPTY_RESULT);
  transportFactoryMock.mockImplementation(({ organisationId }: { organisationId: string }) => (
    { organisationId }
  ));
});

describe('HR-7E5F employee document reminder batch executor', () => {
  it('discovers only active organisations that currently have pending reminder work', async () => {
    await runEmployeeDocumentReminderBatch({
      now: new Date('2026-10-02T00:00:00.000Z'),
    });

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings] = sqlMock.mock.calls[0];
    const query = (strings as TemplateStringsArray).join('?');

    expect(query).toContain("o.status = 'ACTIVE'");
    expect(query).toContain("r.delivery_status = 'PENDING'");
    expect(query).toContain('r.organisation_id = o.id');
    expect(query).toContain('ORDER BY o.id ASC');
  });

  it('uses each organisation local calendar date and an automation actor with no user impersonation', async () => {
    sqlMock.mockResolvedValue([
      { organisation_id: 'org-adelaide', timezone: 'Australia/Adelaide' },
      { organisation_id: 'org-london', timezone: 'Europe/London' },
    ]);

    await runEmployeeDocumentReminderBatch({
      now: new Date('2026-10-02T23:30:00.000Z'),
      limitPerOrganisation: 17,
    });

    expect(processMock).toHaveBeenNthCalledWith(1, {
      actor: { organisationId: 'org-adelaide', userId: null },
      scheduledThrough: '2026-10-03',
      limit: 17,
      transport: { organisationId: 'org-adelaide' },
    });

    expect(processMock).toHaveBeenNthCalledWith(2, {
      actor: { organisationId: 'org-london', userId: null },
      scheduledThrough: '2026-10-03',
      limit: 17,
      transport: { organisationId: 'org-london' },
    });
  });

  it('falls back to UTC when an organisation has no configured timezone', async () => {
    sqlMock.mockResolvedValue([
      { organisation_id: 'org-no-timezone', timezone: null },
    ]);

    await runEmployeeDocumentReminderBatch({
      now: new Date('2026-10-02T23:30:00.000Z'),
    });

    expect(processMock).toHaveBeenCalledWith(expect.objectContaining({
      scheduledThrough: '2026-10-02',
    }));
  });

  it('aggregates worker counts without exposing tenant or recipient detail', async () => {
    sqlMock.mockResolvedValue([
      { organisation_id: 'org-a', timezone: 'UTC' },
      { organisation_id: 'org-b', timezone: 'UTC' },
    ]);

    processMock
      .mockResolvedValueOnce({
        discovered: 4,
        claimed: 3,
        discoverySkipped: 1,
        sent: 2,
        failed: 1,
        ambiguous: 0,
        transitionSkipped: 0,
      })
      .mockResolvedValueOnce({
        discovered: 5,
        claimed: 4,
        discoverySkipped: 1,
        sent: 1,
        failed: 1,
        ambiguous: 1,
        transitionSkipped: 1,
      });

    await expect(runEmployeeDocumentReminderBatch({
      now: new Date('2026-10-02T00:00:00.000Z'),
    })).resolves.toEqual({
      organisationsDiscovered: 2,
      organisationsProcessed: 2,
      organisationsFailed: 0,
      discovered: 9,
      claimed: 7,
      discoverySkipped: 2,
      sent: 3,
      failed: 2,
      ambiguous: 1,
      transitionSkipped: 1,
    });
  });

  it('isolates one organisation failure and continues processing the next tenant', async () => {
    sqlMock.mockResolvedValue([
      { organisation_id: 'org-bad-zone', timezone: 'Not/A_Timezone' },
      { organisation_id: 'org-good', timezone: 'UTC' },
    ]);

    processMock.mockResolvedValueOnce({
      discovered: 2,
      claimed: 2,
      discoverySkipped: 0,
      sent: 2,
      failed: 0,
      ambiguous: 0,
      transitionSkipped: 0,
    });

    await expect(runEmployeeDocumentReminderBatch({
      now: new Date('2026-10-02T00:00:00.000Z'),
    })).resolves.toEqual({
      organisationsDiscovered: 2,
      organisationsProcessed: 1,
      organisationsFailed: 1,
      discovered: 2,
      claimed: 2,
      discoverySkipped: 0,
      sent: 2,
      failed: 0,
      ambiguous: 0,
      transitionSkipped: 0,
    });

    expect(processMock).toHaveBeenCalledTimes(1);
    expect(processMock).toHaveBeenCalledWith(expect.objectContaining({
      actor: { organisationId: 'org-good', userId: null },
    }));
  });

  it('rejects an invalid injected clock before querying the database', async () => {
    await expect(runEmployeeDocumentReminderBatch({
      now: new Date(Number.NaN),
    })).rejects.toThrow('now must be a valid Date.');

    expect(sqlMock).not.toHaveBeenCalled();
    expect(processMock).not.toHaveBeenCalled();
  });
});
