import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailSendError } from '@/lib/email';

const sqlMock = vi.fn();
const sendEmailMock = vi.fn();

vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}));

vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email')>();
  return {
    ...actual,
    sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  };
});

const {
  buildEmployeeDocumentReminderEmail,
  createEmployeeDocumentReminderEmailTransport,
} = await import('@/lib/hr/employeeDocumentReminderEmailTransport');

const DELIVERY = {
  id: '66666666-6666-4666-8666-666666666666',
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

function activeContext(overrides: Record<string, unknown> = {}) {
  return {
    recipient_email: 'employee@example.com',
    recipient_name: 'Employee Example',
    recipient_status: 'ACTIVE',
    document_title: 'Safety policy',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlMock.mockResolvedValue([activeContext()]);
  sendEmailMock.mockResolvedValue({ status: 'sent', id: 'email-1' });
});

describe('HR-7E5E employee document reminder email transport', () => {
  it('resolves reminder context inside the active organisation and exact version', async () => {
    const transport = createEmployeeDocumentReminderEmailTransport({
      organisationId: 'org-a',
    });

    await transport(DELIVERY);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const query = (strings as TemplateStringsArray).join('?');
    expect(query).toContain('u.organisation_id = v.organisation_id');
    expect(query).toContain('v.organisation_id = ?');
    expect(query).toContain('v.id = ?::uuid');
    expect(values).toEqual([
      'employee-user',
      'org-a',
      '33333333-3333-4333-8333-333333333333',
    ]);
  });

  it('returns a definite failure when the reminder context no longer resolves', async () => {
    sqlMock.mockResolvedValue([]);
    const transport = createEmployeeDocumentReminderEmailTransport({
      organisationId: 'org-a',
    });

    await expect(transport(DELIVERY)).resolves.toEqual({
      outcome: 'definite_failure',
      failureCode: 'reminder_context_unavailable',
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('does not send to an inactive recipient or one without an email address', async () => {
    const transport = createEmployeeDocumentReminderEmailTransport({
      organisationId: 'org-a',
    });

    sqlMock.mockResolvedValueOnce([activeContext({ recipient_status: 'DISABLED' })]);
    await expect(transport(DELIVERY)).resolves.toEqual({
      outcome: 'definite_failure',
      failureCode: 'recipient_email_unavailable',
    });

    sqlMock.mockResolvedValueOnce([activeContext({ recipient_email: null })]);
    await expect(transport(DELIVERY)).resolves.toEqual({
      outcome: 'definite_failure',
      failureCode: 'recipient_email_unavailable',
    });

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('sends through the shared BrainBase email path and reports sent only on provider acceptance', async () => {
    const transport = createEmployeeDocumentReminderEmailTransport({
      organisationId: 'org-a',
    });

    await expect(transport(DELIVERY)).resolves.toEqual({ outcome: 'sent' });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'employee@example.com',
      subject: 'Employee document action required — Safety policy',
    }));
    const payload = sendEmailMock.mock.calls[0][0] as { html: string };
    expect(payload.html).toContain('Employee Example');
    expect(payload.html).toContain('Safety policy');
    expect(payload.html).toContain('review and acknowledge');
  });

  it('treats missing email-provider configuration as a definite non-send', async () => {
    sendEmailMock.mockResolvedValue({ status: 'not_configured', id: null });
    const transport = createEmployeeDocumentReminderEmailTransport({
      organisationId: 'org-a',
    });

    await expect(transport(DELIVERY)).resolves.toEqual({
      outcome: 'definite_failure',
      failureCode: 'email_not_configured',
    });
  });

  it('maps a provider rejection to a definite failure with a normalized code', async () => {
    sendEmailMock.mockRejectedValue(
      new EmailSendError(422, 'invalid_recipient'),
    );
    const transport = createEmployeeDocumentReminderEmailTransport({
      organisationId: 'org-a',
    });

    await expect(transport(DELIVERY)).resolves.toEqual({
      outcome: 'definite_failure',
      failureCode: 'email_provider_rejected_invalid_recipient',
    });
  });

  it('keeps network and unknown send exceptions ambiguous', async () => {
    sendEmailMock.mockRejectedValue(new Error('socket closed after write'));
    const transport = createEmployeeDocumentReminderEmailTransport({
      organisationId: 'org-a',
    });

    await expect(transport(DELIVERY)).resolves.toEqual({
      outcome: 'ambiguous',
      failureCode: 'email_transport_ambiguous',
    });
  });

  it('escapes recipient and document text in the generated HTML', () => {
    const message = buildEmployeeDocumentReminderEmail({
      recipientName: '<Admin & Co>',
      documentTitle: '<Safety & Conduct>',
      reminderType: 'verification_due',
    });

    expect(message.html).toContain('&lt;Admin &amp; Co&gt;');
    expect(message.html).toContain('&lt;Safety &amp; Conduct&gt;');
    expect(message.html).not.toContain('<Admin & Co>');
    expect(message.html).not.toContain('<Safety & Conduct>');
    expect(message.html).toContain('review and verify');
  });
});
