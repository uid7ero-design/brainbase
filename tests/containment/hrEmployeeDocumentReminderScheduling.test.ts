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

const { scheduleEmployeeDocumentReminderDelivery } = await import(
  '@/lib/hr/employeeDocumentReminderScheduling'
);

const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const DELIVERY_ID = '66666666-6666-4666-8666-666666666666';

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

function row(overrides: Record<string, unknown> = {}) {
  return {
    version_exists: true,
    recipient_exists: true,
    delivery_id: DELIVERY_ID,
    document_version_id: VERSION_ID,
    recipient_user_id: 'employee-user',
    reminder_type: 'acknowledgement_due',
    scheduled_for: '2026-10-08',
    delivery_status: 'PENDING',
    claimed_at: null,
    sent_at: null,
    failed_at: null,
    failure_code: null,
    inserted: true,
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

describe('HR-7E5C employee document reminder scheduling', () => {
  it('creates a pending reminder for a live version and active same-org recipient', async () => {
    queue([{ locked: null }], [row()]);

    const result = await scheduleEmployeeDocumentReminderDelivery({
      actor: SYSTEM_ACTOR,
      documentVersionId: VERSION_ID,
      recipientUserId: 'employee-user',
      reminderType: ' acknowledgement_due ',
      scheduledFor: '2026-10-08',
    });

    expect(result).toEqual({
      outcome: 'scheduled',
      delivery: {
        id: DELIVERY_ID,
        documentVersionId: VERSION_ID,
        recipientUserId: 'employee-user',
        reminderType: 'acknowledgement_due',
        scheduledFor: '2026-10-08',
        deliveryStatus: 'PENDING',
        claimedAt: null,
        sentAt: null,
        failedAt: null,
        failureCode: null,
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('pg_advisory_xact_lock');
    expect(calls[1].text).toContain('JOIN hr_employee_documents d');
    expect(calls[1].text).toContain('d.deleted_at IS NULL');
    expect(calls[1].text).toContain("u.status = 'ACTIVE'");
    expect(calls[1].text).toContain('INSERT INTO hr_employee_document_reminder_deliveries');
    expect(calls[1].text).toContain('ON CONFLICT');
    expect(calls[1].text).toContain("'hr_employee_document_reminder_delivery.created'");
    expect(calls[1].text).toContain('INSERT INTO audit_logs');
  });

  it('returns an existing stable-identity delivery idempotently without a second audit', async () => {
    queue([{ locked: null }], [row({ inserted: false, audit_written: false, delivery_status: 'SENT' })]);

    const result = await scheduleEmployeeDocumentReminderDelivery({
      actor: SYSTEM_ACTOR,
      documentVersionId: VERSION_ID,
      recipientUserId: 'employee-user',
      reminderType: 'acknowledgement_due',
      scheduledFor: '2026-10-08',
    });

    expect(result.outcome).toBe('already_scheduled');
    expect(result.outcome === 'already_scheduled' && result.delivery.deliveryStatus).toBe('SENT');
    expect(calls[1].text).toContain('existing_delivery AS MATERIALIZED');
  });

  it('distinguishes missing version from invalid recipient scope', async () => {
    queue([{ locked: null }], [row({
      version_exists: false,
      delivery_id: null,
      document_version_id: null,
      recipient_user_id: null,
      reminder_type: null,
      scheduled_for: null,
      delivery_status: null,
      inserted: false,
      audit_written: false,
    })]);

    await expect(scheduleEmployeeDocumentReminderDelivery({
      actor: SYSTEM_ACTOR,
      documentVersionId: VERSION_ID,
      recipientUserId: 'employee-user',
      reminderType: 'acknowledgement_due',
      scheduledFor: '2026-10-08',
    })).resolves.toEqual({ outcome: 'version_not_found' });

    queue([{ locked: null }], [row({
      recipient_exists: false,
      delivery_id: null,
      document_version_id: null,
      recipient_user_id: null,
      reminder_type: null,
      scheduled_for: null,
      delivery_status: null,
      inserted: false,
      audit_written: false,
    })]);

    await expect(scheduleEmployeeDocumentReminderDelivery({
      actor: SYSTEM_ACTOR,
      documentVersionId: VERSION_ID,
      recipientUserId: 'other-user',
      reminderType: 'acknowledgement_due',
      scheduledFor: '2026-10-08',
    })).resolves.toEqual({ outcome: 'recipient_not_found' });
  });

  it('validates reminder type and calendar date before touching the database', async () => {
    await expect(scheduleEmployeeDocumentReminderDelivery({
      actor: SYSTEM_ACTOR,
      documentVersionId: VERSION_ID,
      recipientUserId: 'employee-user',
      reminderType: '   ',
      scheduledFor: '2026-10-08',
    })).rejects.toThrow(/reminderType must not be blank/);

    await expect(scheduleEmployeeDocumentReminderDelivery({
      actor: SYSTEM_ACTOR,
      documentVersionId: VERSION_ID,
      recipientUserId: 'employee-user',
      reminderType: 'acknowledgement_due',
      scheduledFor: '08/10/2026',
    })).rejects.toThrow(/ISO calendar date/);

    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('fails newly inserted state unless its audit row is persisted', async () => {
    queue([{ locked: null }], [row({ audit_written: false })]);

    await expect(scheduleEmployeeDocumentReminderDelivery({
      actor: SYSTEM_ACTOR,
      documentVersionId: VERSION_ID,
      recipientUserId: 'employee-user',
      reminderType: 'acknowledgement_due',
      scheduledFor: '2026-10-08',
    })).rejects.toThrow(/scheduling audit was not written/);
  });

  it('rejects impossible audit evidence on an existing delivery', async () => {
    queue([{ locked: null }], [row({ inserted: false, audit_written: true })]);

    await expect(scheduleEmployeeDocumentReminderDelivery({
      actor: SYSTEM_ACTOR,
      documentVersionId: VERSION_ID,
      recipientUserId: 'employee-user',
      reminderType: 'acknowledgement_due',
      scheduledFor: '2026-10-08',
    })).rejects.toThrow(/unexpectedly wrote an audit event/);
  });
});
