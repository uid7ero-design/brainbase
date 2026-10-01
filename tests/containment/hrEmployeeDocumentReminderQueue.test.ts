import { beforeEach, describe, expect, it, vi } from 'vitest';

type QuerySpec = { text: string; values: unknown[] };

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]): QuerySpec => ({
  text: strings.join('?'),
  values,
}));

const claimMock = vi.fn();

vi.mock('@/lib/db', () => ({
  default: (...args: [TemplateStringsArray, ...unknown[]]) => sqlMock(...args),
}));

vi.mock('@/lib/hr/employeeDocumentReminderDeliveryMutations', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/lib/hr/employeeDocumentReminderDeliveryMutations')
  >();
  return {
    ...actual,
    claimEmployeeDocumentReminderDelivery: (...args: unknown[]) => claimMock(...args),
  };
});

const { claimDueEmployeeDocumentReminders } = await import(
  '@/lib/hr/employeeDocumentReminderQueue'
);

const DELIVERY_A = '66666666-6666-4666-8666-666666666666';
const DELIVERY_B = '77777777-7777-4777-8777-777777777777';

const ACTOR = {
  organisationId: 'org-a',
  userId: null,
  ipAddress: null,
  userAgent: 'brainbase-reminder-worker',
};

function claimedDelivery(id: string) {
  return {
    outcome: 'claimed' as const,
    delivery: {
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
    },
  };
}

beforeEach(() => {
  sqlMock.mockReset();
  claimMock.mockReset();
});

describe('HR-7E5B employee document reminder queue', () => {
  it('discovers due pending reminders in a bounded tenant-scoped query', async () => {
    sqlMock.mockResolvedValue([{ id: DELIVERY_A }]);
    claimMock.mockResolvedValue(claimedDelivery(DELIVERY_A));

    const result = await claimDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
      limit: 10,
    });

    expect(result).toEqual({
      discovered: 1,
      claimed: [claimedDelivery(DELIVERY_A).delivery],
      skipped: 0,
    });

    const query = sqlMock.mock.calls[0];
    expect(query).toBeDefined();
    const [strings, ...values] = query as unknown as [TemplateStringsArray, ...unknown[]];
    const text = strings.join('?');
    expect(text).toContain('FROM hr_employee_document_reminder_deliveries r');
    expect(text).toContain('r.organisation_id = ?');
    expect(text).toContain("r.delivery_status = 'PENDING'");
    expect(text).toContain('r.scheduled_for <= ?::date');
    expect(text).toContain('ORDER BY r.scheduled_for ASC, r.created_at ASC, r.id ASC');
    expect(text).toContain('LIMIT ?');
    expect(values).toContain('org-a');
    expect(values).toContain('2026-10-01');
    expect(values).toContain(10);
  });

  it('claims every discovered id through the HR-7E5A mutation boundary', async () => {
    sqlMock.mockResolvedValue([{ id: DELIVERY_A }, { id: DELIVERY_B }]);
    claimMock
      .mockResolvedValueOnce(claimedDelivery(DELIVERY_A))
      .mockResolvedValueOnce(claimedDelivery(DELIVERY_B));

    const result = await claimDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
    });

    expect(claimMock).toHaveBeenNthCalledWith(1, {
      actor: ACTOR,
      deliveryId: DELIVERY_A,
      scheduledThrough: '2026-10-01',
    });
    expect(claimMock).toHaveBeenNthCalledWith(2, {
      actor: ACTOR,
      deliveryId: DELIVERY_B,
      scheduledThrough: '2026-10-01',
    });
    expect(result.discovered).toBe(2);
    expect(result.claimed).toHaveLength(2);
    expect(result.skipped).toBe(0);
  });

  it('treats race-time claim losses as skipped rather than worker failures', async () => {
    sqlMock.mockResolvedValue([{ id: DELIVERY_A }, { id: DELIVERY_B }]);
    claimMock
      .mockResolvedValueOnce({ outcome: 'not_pending', status: 'CLAIMED' })
      .mockResolvedValueOnce(claimedDelivery(DELIVERY_B));

    const result = await claimDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
    });

    expect(result.discovered).toBe(2);
    expect(result.claimed.map(item => item.id)).toEqual([DELIVERY_B]);
    expect(result.skipped).toBe(1);
  });

  it('returns an empty batch without invoking the mutation layer', async () => {
    sqlMock.mockResolvedValue([]);

    const result = await claimDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
    });

    expect(result).toEqual({ discovered: 0, claimed: [], skipped: 0 });
    expect(claimMock).not.toHaveBeenCalled();
  });

  it('defaults to a bounded batch size of 25', async () => {
    sqlMock.mockResolvedValue([]);

    await claimDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
    });

    const query = sqlMock.mock.calls[0];
    const values = query.slice(1);
    expect(values).toContain(25);
  });

  it('rejects invalid due-date and batch-size inputs before querying', async () => {
    await expect(claimDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '01/10/2026',
    })).rejects.toThrow(/ISO calendar date/);

    await expect(claimDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
      limit: 0,
    })).rejects.toThrow(/between 1 and 100/);

    await expect(claimDueEmployeeDocumentReminders({
      actor: ACTOR,
      scheduledThrough: '2026-10-01',
      limit: 101,
    })).rejects.toThrow(/between 1 and 100/);

    expect(sqlMock).not.toHaveBeenCalled();
    expect(claimMock).not.toHaveBeenCalled();
  });
});
