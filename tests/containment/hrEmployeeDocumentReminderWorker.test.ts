import { beforeEach, describe, expect, it, vi } from 'vitest';

const claimBatchMock = vi.fn();
const markSentMock = vi.fn();
const markFailedMock = vi.fn();

vi.mock('@/lib/hr/employeeDocumentReminderQueue', () => ({
  claimDueEmployeeDocumentReminders: (...args: unknown[]) => claimBatchMock(...args),
}));

vi.mock('@/lib/hr/employeeDocumentReminderDeliveryMutations', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/lib/hr/employeeDocumentReminderDeliveryMutations')
  >();
  return {
    ...actual,
    markEmployeeDocumentReminderDeliverySent: (...args: unknown[]) => markSentMock(...args),
    markEmployeeDocumentReminderDeliveryFailed: (...args: unknown[]) => markFailedMock(...args),
  };
});

const { processDueEmployeeDocumentReminders } = await import(
  '@/lib/hr/employeeDocumentReminderWorker'
);

const ACTOR = {
  organisationId: 'org-a',
  userId: null,
  ipAddress: null,
  userAgent: 'brainbase-reminder-worker',
};

function delivery(id: string) {
  return {
    id,
    documentVersionId: '33333333-3333-4333-8333-333333333333',
    recipientUserId: 'employee-user',
    reminderType: 'acknowledgement_due',
    scheduledFor: '2026-10-01',
    deliveryStatus: 'CLAIMED' as const,
    claimedAt: '2026-10-01T00:30:00.000Z',
    sentAt: null,
    failedAt: null,
    failureCode: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  claimBatchMock.mockResolvedValue({
    discovered: 0,
    claimed: [],
    skipped: 0,
  });
  markSentMock.mockResolvedValue({ outcome: 'recorded', delivery: delivery('sent') });
  markFailedMock.mockResolvedValue({ outcome: 'recorded', delivery: delivery('failed') });
});

describe('HR-7E5D employee document reminder worker', () => {
  it('passes the caller date and bounded limit through to the claim queue', async () => {
    const transport = vi.fn();

    const result = await processDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
      limit: 12,
      transport,
    });

    expect(claimBatchMock).toHaveBeenCalledWith({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
      limit: 12,
    });
    expect(transport).not.toHaveBeenCalled();
    expect(result).toEqual({
      discovered: 0,
      claimed: 0,
      discoverySkipped: 0,
      sent: 0,
      failed: 0,
      ambiguous: 0,
      transitionSkipped: 0,
    });
  });

  it('marks a definitely sent transport result as SENT through HR-7E5A', async () => {
    const item = delivery('66666666-6666-4666-8666-666666666666');
    claimBatchMock.mockResolvedValue({
      discovered: 1,
      claimed: [item],
      skipped: 0,
    });
    const transport = vi.fn().mockResolvedValue({ outcome: 'sent' });

    const result = await processDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
      transport,
    });

    expect(transport).toHaveBeenCalledWith(item);
    expect(markSentMock).toHaveBeenCalledWith({
      actor: ACTOR,
      deliveryId: item.id,
    });
    expect(markFailedMock).not.toHaveBeenCalled();
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('marks a definite transport failure FAILED with a normalized code', async () => {
    const item = delivery('66666666-6666-4666-8666-666666666666');
    claimBatchMock.mockResolvedValue({
      discovered: 1,
      claimed: [item],
      skipped: 0,
    });
    const transport = vi.fn().mockResolvedValue({
      outcome: 'definite_failure',
      failureCode: '  provider_rejected  ',
    });

    const result = await processDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
      transport,
    });

    expect(markFailedMock).toHaveBeenCalledWith({
      actor: ACTOR,
      deliveryId: item.id,
      failureCode: 'provider_rejected',
    });
    expect(markSentMock).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });

  it('leaves an explicitly ambiguous provider result CLAIMED', async () => {
    const item = delivery('66666666-6666-4666-8666-666666666666');
    claimBatchMock.mockResolvedValue({
      discovered: 1,
      claimed: [item],
      skipped: 0,
    });
    const transport = vi.fn().mockResolvedValue({
      outcome: 'ambiguous',
      failureCode: 'network_timeout',
    });

    const result = await processDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
      transport,
    });

    expect(markSentMock).not.toHaveBeenCalled();
    expect(markFailedMock).not.toHaveBeenCalled();
    expect(result.ambiguous).toBe(1);
  });

  it('treats a thrown transport exception as ambiguous and does not transition state', async () => {
    const item = delivery('66666666-6666-4666-8666-666666666666');
    claimBatchMock.mockResolvedValue({
      discovered: 1,
      claimed: [item],
      skipped: 0,
    });
    const transport = vi.fn().mockRejectedValue(new Error('socket closed'));

    const result = await processDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
      transport,
    });

    expect(markSentMock).not.toHaveBeenCalled();
    expect(markFailedMock).not.toHaveBeenCalled();
    expect(result.ambiguous).toBe(1);
  });

  it('does not count a stale state transition as sent or failed', async () => {
    const first = delivery('66666666-6666-4666-8666-666666666666');
    const second = delivery('77777777-7777-4777-8777-777777777777');
    claimBatchMock.mockResolvedValue({
      discovered: 2,
      claimed: [first, second],
      skipped: 0,
    });
    const transport = vi.fn()
      .mockResolvedValueOnce({ outcome: 'sent' })
      .mockResolvedValueOnce({
        outcome: 'definite_failure',
        failureCode: 'provider_rejected',
      });
    markSentMock.mockResolvedValueOnce({ outcome: 'not_claimed', status: 'SENT' });
    markFailedMock.mockResolvedValueOnce({ outcome: 'not_claimed', status: 'FAILED' });

    const result = await processDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
      transport,
    });

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.transitionSkipped).toBe(2);
  });

  it('carries queue-level race skips into the worker summary', async () => {
    const item = delivery('66666666-6666-4666-8666-666666666666');
    claimBatchMock.mockResolvedValue({
      discovered: 3,
      claimed: [item],
      skipped: 2,
    });
    const transport = vi.fn().mockResolvedValue({ outcome: 'sent' });

    const result = await processDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
      transport,
    });

    expect(result.discovered).toBe(3);
    expect(result.claimed).toBe(1);
    expect(result.discoverySkipped).toBe(2);
  });

  it('rejects a definite failure with a blank failure code before writing FAILED', async () => {
    const item = delivery('66666666-6666-4666-8666-666666666666');
    claimBatchMock.mockResolvedValue({
      discovered: 1,
      claimed: [item],
      skipped: 0,
    });
    const transport = vi.fn().mockResolvedValue({
      outcome: 'definite_failure',
      failureCode: '   ',
    });

    await expect(processDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
      transport,
    })).rejects.toThrow(/non-blank failureCode/);

    expect(markFailedMock).not.toHaveBeenCalled();
  });
});
