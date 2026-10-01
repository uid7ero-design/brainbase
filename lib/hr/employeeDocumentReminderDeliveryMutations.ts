import sql from '@/lib/db';

export type EmployeeDocumentReminderActor = {
  organisationId: string;
  userId: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type EmployeeDocumentReminderDeliveryStatus =
  | 'PENDING'
  | 'CLAIMED'
  | 'SENT'
  | 'FAILED';

export type EmployeeDocumentReminderDelivery = {
  id: string;
  documentVersionId: string;
  recipientUserId: string;
  reminderType: string;
  scheduledFor: Date | string;
  deliveryStatus: EmployeeDocumentReminderDeliveryStatus;
  claimedAt: Date | string | null;
  sentAt: Date | string | null;
  failedAt: Date | string | null;
  failureCode: string | null;
};

type ReminderMutationRow = {
  delivery_exists: boolean;
  prior_status: EmployeeDocumentReminderDeliveryStatus | null;
  scheduled_for: Date | string | null;
  delivery_id: string | null;
  document_version_id: string | null;
  recipient_user_id: string | null;
  reminder_type: string | null;
  delivery_status: EmployeeDocumentReminderDeliveryStatus | null;
  claimed_at: Date | string | null;
  sent_at: Date | string | null;
  failed_at: Date | string | null;
  failure_code: string | null;
  audit_written: boolean;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function reminderFromRow(row: ReminderMutationRow): EmployeeDocumentReminderDelivery {
  if (
    !row.delivery_id
    || !row.document_version_id
    || !row.recipient_user_id
    || !row.reminder_type
    || !row.scheduled_for
    || !row.delivery_status
  ) {
    throw new Error('Employee document reminder delivery did not resolve persisted state.');
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
 * Atomically claims one due PENDING reminder delivery. Discovery/batching is
 * deliberately out of scope: callers supply a stable delivery id and the
 * local calendar date through which work is due.
 */
export async function claimEmployeeDocumentReminderDelivery(params: {
  actor: EmployeeDocumentReminderActor;
  deliveryId: string;
  scheduledThrough: string;
}): Promise<
  | { outcome: 'claimed'; delivery: EmployeeDocumentReminderDelivery }
  | { outcome: 'not_found' }
  | { outcome: 'not_due' }
  | { outcome: 'not_pending'; status: EmployeeDocumentReminderDeliveryStatus }
> {
  if (!ISO_DATE_RE.test(params.scheduledThrough)) {
    throw new Error('scheduledThrough must be an ISO calendar date.');
  }

  const auditId = crypto.randomUUID();
  const [, rows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`hr-employee-document-reminder:${params.actor.organisationId}:${params.deliveryId}`},
          0
        )
      ) AS locked
    `,
    txn`
      WITH delivery_scope AS MATERIALIZED (
        SELECT
          r.id,
          r.organisation_id,
          r.document_version_id,
          r.recipient_user_id,
          r.reminder_type,
          r.scheduled_for,
          r.delivery_status,
          r.claimed_at,
          r.sent_at,
          r.failed_at,
          r.failure_code
        FROM hr_employee_document_reminder_deliveries r
        WHERE r.organisation_id = ${params.actor.organisationId}
          AND r.id = ${params.deliveryId}::uuid
        LIMIT 1
        FOR UPDATE
      ),
      claimed AS (
        UPDATE hr_employee_document_reminder_deliveries r
        SET
          delivery_status = 'CLAIMED',
          claimed_at = now(),
          updated_at = now()
        FROM delivery_scope s
        WHERE r.organisation_id = s.organisation_id
          AND r.id = s.id
          AND s.delivery_status = 'PENDING'
          AND s.scheduled_for <= ${params.scheduledThrough}::date
        RETURNING
          r.id, r.organisation_id, r.document_version_id, r.recipient_user_id,
          r.reminder_type, r.scheduled_for, r.delivery_status,
          r.claimed_at, r.sent_at, r.failed_at, r.failure_code
      ),
      claim_audit AS (
        INSERT INTO audit_logs (
          id, organisation_id, user_id, action, resource_type, resource_id,
          before_state, after_state, ip_address, user_agent
        )
        SELECT
          ${auditId},
          c.organisation_id,
          ${params.actor.userId},
          'hr_employee_document_reminder_delivery.claimed',
          'hr_employee_document_reminder_delivery',
          c.id::text,
          jsonb_build_object(
            'delivery_status', 'PENDING',
            'claimed_at', NULL
          ),
          jsonb_build_object(
            'document_version_id', c.document_version_id::text,
            'recipient_user_id', c.recipient_user_id,
            'reminder_type', c.reminder_type,
            'scheduled_for', c.scheduled_for,
            'delivery_status', c.delivery_status,
            'claimed_at', c.claimed_at
          ),
          ${params.actor.ipAddress ?? null},
          ${params.actor.userAgent ?? null}
        FROM claimed c
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM delivery_scope) AS delivery_exists,
        (SELECT delivery_status FROM delivery_scope) AS prior_status,
        (SELECT scheduled_for FROM delivery_scope) AS scheduled_for,
        c.id::text AS delivery_id,
        c.document_version_id::text AS document_version_id,
        c.recipient_user_id,
        c.reminder_type,
        c.delivery_status,
        c.claimed_at,
        c.sent_at,
        c.failed_at,
        c.failure_code,
        EXISTS (SELECT 1 FROM claim_audit) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN claimed c ON TRUE
    `,
  ]);

  const row = (rows as ReminderMutationRow[])[0];
  if (!row) throw new Error('Employee document reminder claim returned no state row.');
  if (!row.delivery_exists) return { outcome: 'not_found' };
  if (row.delivery_id) {
    if (!row.audit_written) {
      throw new Error('Employee document reminder claim audit was not written.');
    }
    return { outcome: 'claimed', delivery: reminderFromRow(row) };
  }
  if (row.prior_status !== 'PENDING') {
    if (!row.prior_status) throw new Error('Employee document reminder claim lost prior state.');
    return { outcome: 'not_pending', status: row.prior_status };
  }

  return { outcome: 'not_due' };
}

async function completeClaimedReminder(params: {
  actor: EmployeeDocumentReminderActor;
  deliveryId: string;
  outcome: 'SENT' | 'FAILED';
  failureCode: string | null;
}): Promise<
  | { outcome: 'recorded'; delivery: EmployeeDocumentReminderDelivery }
  | { outcome: 'not_found' }
  | { outcome: 'not_claimed'; status: EmployeeDocumentReminderDeliveryStatus }
> {
  const auditId = crypto.randomUUID();
  const [, rows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`hr-employee-document-reminder:${params.actor.organisationId}:${params.deliveryId}`},
          0
        )
      ) AS locked
    `,
    txn`
      WITH delivery_scope AS MATERIALIZED (
        SELECT
          r.id,
          r.organisation_id,
          r.document_version_id,
          r.recipient_user_id,
          r.reminder_type,
          r.scheduled_for,
          r.delivery_status,
          r.claimed_at,
          r.sent_at,
          r.failed_at,
          r.failure_code
        FROM hr_employee_document_reminder_deliveries r
        WHERE r.organisation_id = ${params.actor.organisationId}
          AND r.id = ${params.deliveryId}::uuid
        LIMIT 1
        FOR UPDATE
      ),
      completed AS (
        UPDATE hr_employee_document_reminder_deliveries r
        SET
          delivery_status = ${params.outcome},
          sent_at = CASE WHEN ${params.outcome} = 'SENT' THEN now() ELSE NULL END,
          failed_at = CASE WHEN ${params.outcome} = 'FAILED' THEN now() ELSE NULL END,
          failure_code = CASE WHEN ${params.outcome} = 'FAILED' THEN ${params.failureCode} ELSE NULL END,
          updated_at = now()
        FROM delivery_scope s
        WHERE r.organisation_id = s.organisation_id
          AND r.id = s.id
          AND s.delivery_status = 'CLAIMED'
        RETURNING
          r.id, r.organisation_id, r.document_version_id, r.recipient_user_id,
          r.reminder_type, r.scheduled_for, r.delivery_status,
          r.claimed_at, r.sent_at, r.failed_at, r.failure_code
      ),
      completion_audit AS (
        INSERT INTO audit_logs (
          id, organisation_id, user_id, action, resource_type, resource_id,
          before_state, after_state, ip_address, user_agent
        )
        SELECT
          ${auditId},
          c.organisation_id,
          ${params.actor.userId},
          CASE
            WHEN c.delivery_status = 'SENT'
              THEN 'hr_employee_document_reminder_delivery.sent'
            ELSE 'hr_employee_document_reminder_delivery.failed'
          END,
          'hr_employee_document_reminder_delivery',
          c.id::text,
          jsonb_build_object(
            'delivery_status', 'CLAIMED',
            'claimed_at', c.claimed_at
          ),
          jsonb_build_object(
            'document_version_id', c.document_version_id::text,
            'recipient_user_id', c.recipient_user_id,
            'reminder_type', c.reminder_type,
            'scheduled_for', c.scheduled_for,
            'delivery_status', c.delivery_status,
            'claimed_at', c.claimed_at,
            'sent_at', c.sent_at,
            'failed_at', c.failed_at,
            'failure_code', CASE
              WHEN c.failure_code IS NULL THEN NULL
              ELSE '[redacted]'
            END
          ),
          ${params.actor.ipAddress ?? null},
          ${params.actor.userAgent ?? null}
        FROM completed c
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM delivery_scope) AS delivery_exists,
        (SELECT delivery_status FROM delivery_scope) AS prior_status,
        (SELECT scheduled_for FROM delivery_scope) AS scheduled_for,
        c.id::text AS delivery_id,
        c.document_version_id::text AS document_version_id,
        c.recipient_user_id,
        c.reminder_type,
        c.delivery_status,
        c.claimed_at,
        c.sent_at,
        c.failed_at,
        c.failure_code,
        EXISTS (SELECT 1 FROM completion_audit) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN completed c ON TRUE
    `,
  ]);

  const row = (rows as ReminderMutationRow[])[0];
  if (!row) throw new Error('Employee document reminder completion returned no state row.');
  if (!row.delivery_exists) return { outcome: 'not_found' };
  if (!row.delivery_id) {
    if (!row.prior_status) throw new Error('Employee document reminder completion lost prior state.');
    return { outcome: 'not_claimed', status: row.prior_status };
  }
  if (!row.audit_written) {
    throw new Error('Employee document reminder completion audit was not written.');
  }

  return { outcome: 'recorded', delivery: reminderFromRow(row) };
}

export async function markEmployeeDocumentReminderDeliverySent(params: {
  actor: EmployeeDocumentReminderActor;
  deliveryId: string;
}) {
  return completeClaimedReminder({
    ...params,
    outcome: 'SENT',
    failureCode: null,
  });
}

export async function markEmployeeDocumentReminderDeliveryFailed(params: {
  actor: EmployeeDocumentReminderActor;
  deliveryId: string;
  failureCode: string;
}) {
  const failureCode = params.failureCode.trim();
  if (!failureCode) {
    throw new Error('failureCode must not be blank.');
  }

  return completeClaimedReminder({
    actor: params.actor,
    deliveryId: params.deliveryId,
    outcome: 'FAILED',
    failureCode,
  });
}
