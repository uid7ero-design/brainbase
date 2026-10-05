import sql from '@/lib/db';
import {
  claimEmployeeDocumentReminderDelivery,
  type EmployeeDocumentReminderActor,
  type EmployeeDocumentReminderDelivery,
} from './employeeDocumentReminderDeliveryMutations';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BATCH_SIZE = 100;

type DueReminderRow = {
  id: string;
};

export type EmployeeDocumentReminderClaimBatch = {
  discovered: number;
  claimed: EmployeeDocumentReminderDelivery[];
  skipped: number;
};

/**
 * Finds a bounded set of due PENDING reminder ledger rows and attempts to
 * claim each through the HR-7E5A state machine. Discovery is intentionally
 * advisory: concurrent workers may see the same id, but only one can claim
 * it because the mutation layer serializes and re-checks state.
 */
export async function claimDueEmployeeDocumentReminders(params: {
  actor: EmployeeDocumentReminderActor;
  scheduledThrough: string;
  limit?: number;
}): Promise<EmployeeDocumentReminderClaimBatch> {
  if (!ISO_DATE_RE.test(params.scheduledThrough)) {
    throw new Error('scheduledThrough must be an ISO calendar date.');
  }

  const limit = params.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new Error(`limit must be an integer between 1 and ${MAX_BATCH_SIZE}.`);
  }

  const rows = await sql`
    SELECT r.id::text AS id
    FROM hr_employee_document_reminder_deliveries r
    WHERE r.organisation_id = ${params.actor.organisationId}
      AND r.delivery_status = 'PENDING'
      AND r.scheduled_for <= ${params.scheduledThrough}::date
    ORDER BY r.scheduled_for ASC, r.created_at ASC, r.id ASC
    LIMIT ${limit}
  ` as DueReminderRow[];

  const claimed: EmployeeDocumentReminderDelivery[] = [];
  let skipped = 0;

  for (const row of rows) {
    const result = await claimEmployeeDocumentReminderDelivery({
      actor: params.actor,
      deliveryId: row.id,
      scheduledThrough: params.scheduledThrough,
    });

    if (result.outcome === 'claimed') {
      claimed.push(result.delivery);
    } else {
      skipped += 1;
    }
  }

  return {
    discovered: rows.length,
    claimed,
    skipped,
  };
}
