import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn(async () => []);
vi.mock('@/lib/db', () => ({ default: sqlMock }));

const { logHrEvent } = await import('@/lib/hr/auditLog');

function jsonStates(): Record<string, unknown>[] {
  const args = (sqlMock.mock.calls[0] as unknown as [string[], ...unknown[]]).slice(1);
  return args
    .filter((arg): arg is string => typeof arg === 'string' && arg.startsWith('{'))
    .map(arg => JSON.parse(arg) as Record<string, unknown>);
}

beforeEach(() => {
  sqlMock.mockClear();
});

describe('HR-7E2 employee document assurance audit policies', () => {
  it('projects acknowledgement evidence without unrelated state', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'employee-user' },
      {
        action: 'hr_employee_document_acknowledgement.created',
        resourceType: 'hr_employee_document_acknowledgement',
        resourceId: 'ack-1',
        afterState: {
          id: 'ack-1',
          organisation_id: 'org-a',
          document_version_id: 'version-1',
          acknowledged_by: 'employee-user',
          acknowledged_at: '2026-09-27T10:00:00Z',
          created_at: '2026-09-27T10:00:00Z',
          future_sensitive_field: 'must not leak',
        },
      },
    );

    const [state] = jsonStates();
    expect(state).toEqual({
      document_version_id: 'version-1',
      acknowledged_by: 'employee-user',
      acknowledged_at: '2026-09-27T10:00:00Z',
      future_sensitive_field: '[redacted]',
    });
  });

  it('redacts verification comments while retaining decision metadata', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'hr-user' },
      {
        action: 'hr_employee_document_verification.created',
        resourceType: 'hr_employee_document_verification',
        resourceId: 'verification-1',
        afterState: {
          id: 'verification-1',
          organisation_id: 'org-a',
          document_version_id: 'version-1',
          verified_by: 'hr-user',
          decision: 'REJECTED',
          comment: 'Contains private supporting detail',
          verified_at: '2026-09-27T10:01:00Z',
          created_at: '2026-09-27T10:01:00Z',
          future_sensitive_field: 'must not leak',
        },
      },
    );

    const [state] = jsonStates();
    expect(state).toEqual({
      document_version_id: 'version-1',
      verified_by: 'hr-user',
      decision: 'REJECTED',
      comment: '[redacted]',
      verified_at: '2026-09-27T10:01:00Z',
      future_sensitive_field: '[redacted]',
    });
  });

  it('redacts reminder failure detail but keeps delivery-state metadata', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'system-user' },
      {
        action: 'hr_employee_document_reminder_delivery.failed',
        resourceType: 'hr_employee_document_reminder_delivery',
        resourceId: 'delivery-1',
        afterState: {
          id: 'delivery-1',
          organisation_id: 'org-a',
          document_version_id: 'version-1',
          recipient_user_id: 'employee-user',
          reminder_type: 'EXPIRY',
          scheduled_for: '2027-08-01',
          delivery_status: 'FAILED',
          claimed_at: '2027-08-01T00:01:00Z',
          sent_at: null,
          failed_at: '2027-08-01T00:02:00Z',
          failure_code: 'provider response containing private detail',
          created_at: '2027-08-01T00:00:00Z',
          updated_at: '2027-08-01T00:02:00Z',
          future_sensitive_field: 'must not leak',
        },
      },
    );

    const [state] = jsonStates();
    expect(state).toEqual({
      document_version_id: 'version-1',
      recipient_user_id: 'employee-user',
      reminder_type: 'EXPIRY',
      scheduled_for: '2027-08-01',
      delivery_status: 'FAILED',
      claimed_at: '2027-08-01T00:01:00Z',
      sent_at: null,
      failed_at: '2027-08-01T00:02:00Z',
      failure_code: '[redacted]',
      future_sensitive_field: '[redacted]',
    });
  });
});
