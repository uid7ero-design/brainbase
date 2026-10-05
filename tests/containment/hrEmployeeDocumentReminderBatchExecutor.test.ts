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
    expect(query).not.toContain('timezone');
  });

  it('uses the injected clock UTC calendar date and a non-user automation actor', async () => {
    sqlMock.mockResolvedValue([
      { organisation_id: 'org-a' },
      { organisation_id: 'org-b' },
    ]);

    await runEmployeeDocumentReminderBatch({
      now: new Date('2026-10-02T23:30:00.000Z'),
      limitPerOrganisation: 17,
    });

    expect(processMock).toHaveBeenNthCalledWith(1, {
      actor: { organisationId: 'org-a', userId: null },
      scheduledThrough: '2026-10-02',
      limit: 17,
      transport: { organisationId: 'org-a' },
    });

    expect(processMock).toHaveBeenNthCalledWith(2, {
      actor: { organisationId: 'org-b', userId: null },
      scheduledThrough: '2026-10-02',
      limit: 17,
      transport: { organisationId: 'org-b' },
    });
  });

  it('aggregates worker counts without exposing tenant or recipient detail', async () => {
    sqlMock.mockResolvedValue([
      { organisation_id: 'org-a' },
      { organisation_id: 'org-b' },
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

  it('isolates one organisation worker failure and continues processing the next tenant', async () => {
    sqlMock.mockResolvedValue([
      { organisation_id: 'org-fails' },
      { organisation_id: 'org-good' },
    ]);

    processMock
      .mockRejectedValueOnce(new Error('tenant-scoped worker failure'))
      .mockResolvedValueOnce({
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

    expect(processMock).toHaveBeenCalledTimes(2);
    expect(processMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
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
