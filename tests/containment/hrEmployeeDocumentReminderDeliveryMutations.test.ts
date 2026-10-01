import { beforeEach, describe, expect, it, vi } from 'vitest';

type QuerySpec = { text: string; values: unknown[] };
let responses: unknown[] = [];
let callCount = 0;
let calls: QuerySpec[] = [];

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]): QuerySpec => ({
  text: strings.join('?'),
  values,
}));

const transactionMock = vi.fn(async (build: (txn: typeof sqlMock) => QuerySpec[]) => {
  const queries = build(sqlMock);
  const results: unknown[] = [];
  for (const query of queries) {
    calls.push(query);
    results.push(responses[callCount++] ?? []);
  }
  return results;
});

vi.mock('@/lib/db', () => ({
  default: Object.assign(
    (...args: [TemplateStringsArray, ...unknown[]]) => sqlMock(...args),
    {
      transaction: (...args: unknown[]) =>
        transactionMock(...(args as [(txn: typeof sqlMock) => QuerySpec[]])),
    },
  ),
}));

const {
  claimEmployeeDocumentReminderDelivery,
  markEmployeeDocumentReminderDeliverySent,
  markEmployeeDocumentReminderDeliveryFailed,
} = await import('@/lib/hr/employeeDocumentReminderDeliveryMutations');

const DELIVERY_ID = '66666666-6666-4666-8666-666666666666';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';

const SYSTEM_ACTOR = {
  organisationId: 'org-a',
  userId: null,
  ipAddress: null,
  userAgent: 'brainbase-reminder-worker',
};

function queue(...items: unknown[]) {
  responses = items;
  callCount = 0;
}

function reminderRow(overrides: Record<string, unknown> = {}) {
  return {
    delivery_exists: true,
    prior_status: 'PENDING',
    scheduled_for: '2026-10-01',
    delivery_id: DELIVERY_ID,
    document_version_id: VERSION_ID,
    recipient_user_id: 'employee-user',
    reminder_type: 'acknowledgement_due',
    delivery_status: 'CLAIMED',
    claimed_at: '2026-10-01T00:30:00.000Z',
    sent_at: null,
    failed_at: null,
    failure_code: null,
    audit_written: true,
    ...overrides,
  };
}

beforeEach(() => {
  responses = [];
  callCount = 0;
  calls = [];
  sqlMock.mockClear();
  transactionMock.mockClear();
});

describe('HR-7E5A employee document reminder delivery mutations', () => {
  it('claims one due pending delivery and writes audit atomically', async () => {
    queue([{ locked: null }], [reminderRow()]);

    const result = await claimEmployeeDocumentReminderDelivery({
      actor: SYSTEM_ACTOR,
      deliveryId: DELIVERY_ID,
      scheduledThrough: '2026-10-01',
    });

    expect(result).toEqual({
      outcome: 'claimed',
      delivery: {
        id: DELIVERY_ID,
        documentVersionId: VERSION_ID,
        recipientUserId: 'employee-user',
        reminderType: 'acknowledgement_due',
        scheduledFor: '2026-10-01',
        deliveryStatus: 'CLAIMED',
        claimedAt: '2026-10-01T00:30:00.000Z',
        sentAt: null,
        failedAt: null,
        failureCode: null,
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('pg_advisory_xact_lock');
    expect(calls[1].text).toContain('FOR UPDATE');
    expect(calls[1].text).toContain("s.delivery_status = 'PENDING'");
    expect(calls[1].text).toContain('s.scheduled_for <= ?::date');
    expect(calls[1].text).toContain("'hr_employee_document_reminder_delivery.claimed'");
    expect(calls[1].text).toContain('INSERT INTO audit_logs');
  });

  it('does not claim a future pending delivery', async () => {
    queue([{ locked: null }], [reminderRow({
      delivery_id: null,
      document_version_id: null,
      recipient_user_id: null,
      reminder_type: null,
      delivery_status: null,
      claimed_at: null,
      audit_written: false,
    })]);

    await expect(claimEmployeeDocumentReminderDelivery({
      actor: SYSTEM_ACTOR,
      deliveryId: DELIVERY_ID,
      scheduledThrough: '2026-09-30',
    })).resolves.toEqual({ outcome: 'not_due' });
  });

  it('distinguishes missing from already-transitioned deliveries', async () => {
    queue([{ locked: null }], [reminderRow({
      delivery_exists: false,
      prior_status: null,
      scheduled_for: null,
      delivery_id: null,
      document_version_id: null,
      recipient_user_id: null,
      reminder_type: null,
      delivery_status: null,
      claimed_at: null,
      audit_written: false,
    })]);

    await expect(claimEmployeeDocumentReminderDelivery({
      actor: SYSTEM_ACTOR,
      deliveryId: DELIVERY_ID,
      scheduledThrough: '2026-10-01',
    })).resolves.toEqual({ outcome: 'not_found' });

    queue([{ locked: null }], [reminderRow({
      prior_status: 'SENT',
      delivery_id: null,
      document_version_id: null,
      recipient_user_id: null,
      reminder_type: null,
      delivery_status: null,
      audit_written: false,
    })]);

    await expect(claimEmployeeDocumentReminderDelivery({
      actor: SYSTEM_ACTOR,
      deliveryId: DELIVERY_ID,
      scheduledThrough: '2026-10-01',
    })).resolves.toEqual({ outcome: 'not_pending', status: 'SENT' });
  });

  it('validates the caller supplied due-date boundary', async () => {
    await expect(claimEmployeeDocumentReminderDelivery({
      actor: SYSTEM_ACTOR,
      deliveryId: DELIVERY_ID,
      scheduledThrough: '01/10/2026',
    })).rejects.toThrow(/ISO calendar date/);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('fails a claim if business state is not accompanied by audit state', async () => {
    queue([{ locked: null }], [reminderRow({ audit_written: false })]);

    await expect(claimEmployeeDocumentReminderDelivery({
      actor: SYSTEM_ACTOR,
      deliveryId: DELIVERY_ID,
      scheduledThrough: '2026-10-01',
    })).rejects.toThrow(/claim audit was not written/);
  });

  it('marks a claimed delivery sent with atomic audit evidence', async () => {
    queue([{ locked: null }], [reminderRow({
      prior_status: 'CLAIMED',
      delivery_status: 'SENT',
      sent_at: '2026-10-01T00:31:00.000Z',
    })]);

    const result = await markEmployeeDocumentReminderDeliverySent({
      actor: SYSTEM_ACTOR,
      deliveryId: DELIVERY_ID,
    });

    expect(result.outcome).toBe('recorded');
    expect(result.outcome === 'recorded' && result.delivery.deliveryStatus).toBe('SENT');
    expect(calls[1].text).toContain("s.delivery_status = 'CLAIMED'");
    expect(calls[1].text).toContain("'hr_employee_document_reminder_delivery.sent'");
  });

  it('marks a claimed delivery failed and redacts the failure code in audit', async () => {
    queue([{ locked: null }], [reminderRow({
      prior_status: 'CLAIMED',
      delivery_status: 'FAILED',
      failed_at: '2026-10-01T00:31:00.000Z',
      failure_code: 'provider_timeout',
    })]);

    const result = await markEmployeeDocumentReminderDeliveryFailed({
      actor: SYSTEM_ACTOR,
      deliveryId: DELIVERY_ID,
      failureCode: '  provider_timeout  ',
    });

    expect(result.outcome).toBe('recorded');
    expect(result.outcome === 'recorded' && result.delivery.failureCode).toBe('provider_timeout');
    expect(calls[1].values).toContain('provider_timeout');
    expect(calls[1].text).toContain("'hr_employee_document_reminder_delivery.failed'");
    expect(calls[1].text).toContain("'[redacted]'");
  });

  it('refuses completion unless the delivery is currently claimed', async () => {
    queue([{ locked: null }], [reminderRow({
      prior_status: 'PENDING',
      delivery_id: null,
      document_version_id: null,
      recipient_user_id: null,
      reminder_type: null,
      delivery_status: null,
      claimed_at: null,
      audit_written: false,
    })]);

    await expect(markEmployeeDocumentReminderDeliverySent({
      actor: SYSTEM_ACTOR,
      deliveryId: DELIVERY_ID,
    })).resolves.toEqual({ outcome: 'not_claimed', status: 'PENDING' });
  });

  it('validates a non-blank failure code before touching the database', async () => {
    await expect(markEmployeeDocumentReminderDeliveryFailed({
      actor: SYSTEM_ACTOR,
      deliveryId: DELIVERY_ID,
      failureCode: '   ',
    })).rejects.toThrow(/must not be blank/);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('fails completion if the matching audit event is not persisted', async () => {
    queue([{ locked: null }], [reminderRow({
      prior_status: 'CLAIMED',
      delivery_status: 'SENT',
      sent_at: '2026-10-01T00:31:00.000Z',
      audit_written: false,
    })]);

    await expect(markEmployeeDocumentReminderDeliverySent({
      actor: SYSTEM_ACTOR,
      deliveryId: DELIVERY_ID,
    })).rejects.toThrow(/completion audit was not written/);
  });
});
