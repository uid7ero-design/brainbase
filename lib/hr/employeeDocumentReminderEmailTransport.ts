import 'server-only';

import sql from '@/lib/db';
import {
  BASE_URL,
  EmailSendError,
  btnStyle,
  emailLayout,
  escHtml,
  sendEmail,
  type SendEmailResult,
} from '@/lib/email';
import type {
  EmployeeDocumentReminderDelivery,
} from './employeeDocumentReminderDeliveryMutations';
import type {
  EmployeeDocumentReminderTransport,
  EmployeeDocumentReminderTransportResult,
} from './employeeDocumentReminderWorker';

type ReminderContextRow = {
  recipient_email: string | null;
  recipient_name: string;
  recipient_status: string;
  document_title: string;
};

type EmailSender = (options: {
  to: string;
  subject: string;
  html: string;
}) => Promise<SendEmailResult>;

function normalizedProviderFailureCode(error: EmailSendError): string {
  const suffix = (error.providerErrorCode ?? String(error.status))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return suffix
    ? `email_provider_rejected_${suffix}`
    : 'email_provider_rejected';
}

export function buildEmployeeDocumentReminderEmail(params: {
  recipientName: string;
  documentTitle: string;
  reminderType: string;
}) {
  const title = params.documentTitle.trim() || 'Employee document';
  const recipient = params.recipientName.trim() || 'there';

  const action = params.reminderType === 'acknowledgement_due'
    ? 'review and acknowledge'
    : params.reminderType === 'verification_due'
      ? 'review and verify'
      : 'review';

  return {
    subject: `Employee document action required — ${title}`,
    html: emailLayout(`
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111">Hi ${escHtml(recipient)},</h2>
      <p style="margin:0 0 16px;color:#444;line-height:1.6">
        You have an employee document that requires your attention.
      </p>
      <div style="margin:0 0 24px;padding:16px 18px;background:#f9fafb;border:1px solid #e4e4e7;border-radius:8px">
        <div style="font-size:12px;color:#777;margin-bottom:4px">Document</div>
        <div style="font-size:15px;font-weight:600;color:#222">${escHtml(title)}</div>
      </div>
      <p style="margin:0 0 24px;color:#444;line-height:1.6">
        Please sign in to BrainBase to ${action} this document.
      </p>
      <a href="${escHtml(BASE_URL)}" style="${btnStyle}">Open BrainBase</a>
    `),
  };
}

/**
 * Adapts one claimed HR reminder delivery to BrainBase's existing email sender.
 *
 * Provider rejection is definite and may safely transition to FAILED. Network
 * or other unexpected send exceptions are ambiguous and deliberately leave the
 * delivery CLAIMED through HR-7E5D so a later recovery policy can reconcile it
 * without risking an automatic duplicate send.
 */
export function createEmployeeDocumentReminderEmailTransport(params: {
  organisationId: string;
  sender?: EmailSender;
}): EmployeeDocumentReminderTransport {
  const sender = params.sender ?? sendEmail;

  return async (
    delivery: EmployeeDocumentReminderDelivery,
  ): Promise<EmployeeDocumentReminderTransportResult> => {
    const rows = await sql`
      SELECT
        u.email AS recipient_email,
        COALESCE(
          NULLIF(BTRIM(u.display_name), ''),
          NULLIF(BTRIM(u.name), ''),
          u.username
        ) AS recipient_name,
        u.status::text AS recipient_status,
        d.title AS document_title
      FROM hr_employee_document_versions v
      JOIN hr_employee_documents d
        ON d.organisation_id = v.organisation_id
       AND d.id = v.document_id
       AND d.deleted_at IS NULL
      JOIN users u
        ON u.organisation_id = v.organisation_id
       AND u.id = ${delivery.recipientUserId}
      WHERE v.organisation_id = ${params.organisationId}
        AND v.id = ${delivery.documentVersionId}::uuid
      LIMIT 1
    `;

    const context = rows[0] as ReminderContextRow | undefined;
    if (!context) {
      return {
        outcome: 'definite_failure',
        failureCode: 'reminder_context_unavailable',
      };
    }

    if (
      context.recipient_status !== 'ACTIVE'
      || !context.recipient_email
      || !context.recipient_email.trim()
    ) {
      return {
        outcome: 'definite_failure',
        failureCode: 'recipient_email_unavailable',
      };
    }

    const message = buildEmployeeDocumentReminderEmail({
      recipientName: context.recipient_name,
      documentTitle: context.document_title,
      reminderType: delivery.reminderType,
    });

    try {
      const result = await sender({
        to: context.recipient_email.trim(),
        subject: message.subject,
        html: message.html,
      });

      if (result.status === 'not_configured') {
        return {
          outcome: 'definite_failure',
          failureCode: 'email_not_configured',
        };
      }

      return { outcome: 'sent' };
    } catch (error) {
      if (error instanceof EmailSendError) {
        return {
          outcome: 'definite_failure',
          failureCode: normalizedProviderFailureCode(error),
        };
      }

      return {
        outcome: 'ambiguous',
        failureCode: 'email_transport_ambiguous',
      };
    }
  };
}
