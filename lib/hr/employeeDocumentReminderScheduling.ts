import sql from '@/lib/db';
import type {
  EmployeeDocumentReminderActor,
  EmployeeDocumentReminderDelivery,
} from './employeeDocumentReminderDeliveryMutations';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ScheduleReminderRow = {
  version_exists: boolean;
  recipient_exists: boolean;
  delivery_id: string | null;
  document_version_id: string | null;
  recipient_user_id: string | null;
  reminder_type: string | null;
  scheduled_for: Date | string | null;
  delivery_status: 'PENDING' | 'CLAIMED' | 'SENT' | 'FAILED' | null;
  claimed_at: Date | string | null;
  sent_at: Date | string | null;
  failed_at: Date | string | null;
  failure_code: string | null;
  inserted: boolean;
  audit_written: boolean;
};

function deliveryFromRow(row: ScheduleReminderRow): EmployeeDocumentReminderDelivery {
  if (
    !row.delivery_id
    || !row.document_version_id
    || !row.recipient_user_id
    || !row.reminder_type
    || !row.scheduled_for
    || !row.delivery_status
  ) {
    throw new Error('Employee document reminder scheduling did not resolve persisted state.');
  }

  return {
    id: row.delivery_id,
    documentVersionId: row.document_version_id,
    recipientUserId: row.recipient_user_id,
    reminderType: row.reminder_type,
    scheduledFor: row.scheduled_for,
    deliveryStatus: row.delivery_status,
    claimedAt: row.claimed_at,
    sentAt: row.sent_at,
    failedAt: row.failed_at,
    failureCode: row.failure_code,
  };
}

/**
 * Ensures one reminder-delivery ledger row exists for the schema's stable
 * identity: tenant + document version + recipient + reminder type + date.
 * Repeated scheduling is idempotent and does not create duplicate audit rows.
 */
export async function scheduleEmployeeDocumentReminderDelivery(params: {
  actor: EmployeeDocumentReminderActor;
  documentVersionId: string;
  recipientUserId: string;
  reminderType: string;
  scheduledFor: string;
}): Promise<
  | { outcome: 'scheduled'; delivery: EmployeeDocumentReminderDelivery }
  | { outcome: 'already_scheduled'; delivery: EmployeeDocumentReminderDelivery }
  | { outcome: 'version_not_found' }
  | { outcome: 'recipient_not_found' }
> {
  const reminderType = params.reminderType.trim();
  if (!reminderType) {
    throw new Error('reminderType must not be blank.');
  }
  if (!ISO_DATE_RE.test(params.scheduledFor)) {
    throw new Error('scheduledFor must be an ISO calendar date.');
  }

  const deliveryId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const lockKey = [
    'hr-employee-document-reminder-schedule',
    params.actor.organisationId,
    params.documentVersionId,
    params.recipientUserId,
    reminderType,
    params.scheduledFor,
  ].join(':');

  const [, rows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS locked
    `,
    txn`
      WITH version_scope AS MATERIALIZED (
        SELECT v.id, v.organisation_id
        FROM hr_employee_document_versions v
        JOIN hr_employee_documents d
          ON d.organisation_id = v.organisation_id
         AND d.id = v.document_id
         AND d.deleted_at IS NULL
        WHERE v.organisation_id = ${params.actor.organisationId}
          AND v.id = ${params.documentVersionId}::uuid
        LIMIT 1
        FOR SHARE OF v, d
      ),
      recipient_scope AS MATERIALIZED (
        SELECT u.id, u.organisation_id
        FROM users u
        WHERE u.organisation_id = ${params.actor.organisationId}
          AND u.id = ${params.recipientUserId}
          AND u.status = 'ACTIVE'
        LIMIT 1
        FOR SHARE OF u
      ),
      existing_delivery AS MATERIALIZED (
        SELECT
          r.id, r.document_version_id, r.recipient_user_id, r.reminder_type,
          r.scheduled_for, r.delivery_status, r.claimed_at, r.sent_at,
          r.failed_at, r.failure_code
        FROM hr_employee_document_reminder_deliveries r
        WHERE r.organisation_id = ${params.actor.organisationId}
          AND r.document_version_id = ${params.documentVersionId}::uuid
          AND r.recipient_user_id = ${params.recipientUserId}
          AND r.reminder_type = ${reminderType}
          AND r.scheduled_for = ${params.scheduledFor}::date
        LIMIT 1
      ),
      inserted_delivery AS (
        INSERT INTO hr_employee_document_reminder_deliveries (
          id,
          organisation_id,
          document_version_id,
          recipient_user_id,
          reminder_type,
          scheduled_for
        )
        SELECT
          ${deliveryId}::uuid,
          v.organisation_id,
          v.id,
          u.id,
          ${reminderType},
          ${params.scheduledFor}::date
        FROM version_scope v
        CROSS JOIN recipient_scope u
        WHERE NOT EXISTS (SELECT 1 FROM existing_delivery)
        ON CONFLICT (
          organisation_id,
          document_version_id,
          recipient_user_id,
          reminder_type,
          scheduled_for
        ) DO NOTHING
        RETURNING
          id, document_version_id, recipient_user_id, reminder_type,
          scheduled_for, delivery_status, claimed_at, sent_at, failed_at,
          failure_code
      ),
      schedule_audit AS (
        INSERT INTO audit_logs (
          id, organisation_id, user_id, action, resource_type, resource_id,
          before_state, after_state, ip_address, user_agent
        )
        SELECT
          ${auditId},
          ${params.actor.organisationId},
          ${params.actor.userId},
          'hr_employee_document_reminder_delivery.created',
          'hr_employee_document_reminder_delivery',
          d.id::text,
          NULL::jsonb,
          jsonb_build_object(
            'document_version_id', d.document_version_id::text,
            'recipient_user_id', d.recipient_user_id,
            'reminder_type', d.reminder_type,
            'scheduled_for', d.scheduled_for,
            'delivery_status', d.delivery_status,
            'claimed_at', d.claimed_at,
            'sent_at', d.sent_at,
            'failed_at', d.failed_at
          ),
          ${params.actor.ipAddress ?? null},
          ${params.actor.userAgent ?? null}
        FROM inserted_delivery d
        RETURNING id
      ),
      resolved AS (
        SELECT
          d.id::text AS delivery_id,
          d.document_version_id::text AS document_version_id,
          d.recipient_user_id,
          d.reminder_type,
          d.scheduled_for,
          d.delivery_status,
          d.claimed_at,
          d.sent_at,
          d.failed_at,
          d.failure_code,
          true AS inserted
        FROM inserted_delivery d

        UNION ALL

        SELECT
          e.id::text,
          e.document_version_id::text,
          e.recipient_user_id,
          e.reminder_type,
          e.scheduled_for,
          e.delivery_status,
          e.claimed_at,
          e.sent_at,
          e.failed_at,
          e.failure_code,
          false
        FROM existing_delivery e
        WHERE NOT EXISTS (SELECT 1 FROM inserted_delivery)

        LIMIT 1
      )
      SELECT
        EXISTS (SELECT 1 FROM version_scope) AS version_exists,
        EXISTS (SELECT 1 FROM recipient_scope) AS recipient_exists,
        r.delivery_id,
        r.document_version_id,
        r.recipient_user_id,
        r.reminder_type,
        r.scheduled_for,
        r.delivery_status,
        r.claimed_at,
        r.sent_at,
        r.failed_at,
        r.failure_code,
        COALESCE(r.inserted, false) AS inserted,
        EXISTS (SELECT 1 FROM schedule_audit) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN resolved r ON TRUE
    `,
  ]);

  const row = (rows as ScheduleReminderRow[])[0];
  if (!row) throw new Error('Employee document reminder scheduling returned no state row.');
  if (!row.version_exists) return { outcome: 'version_not_found' };
  if (!row.recipient_exists) return { outcome: 'recipient_not_found' };

  const delivery = deliveryFromRow(row);
  if (row.inserted && !row.audit_written) {
    throw new Error('Employee document reminder scheduling audit was not written.');
  }
  if (!row.inserted && row.audit_written) {
    throw new Error('Existing employee document reminder unexpectedly wrote an audit event.');
  }

  return row.inserted
    ? { outcome: 'scheduled', delivery }
    : { outcome: 'already_scheduled', delivery };
}
