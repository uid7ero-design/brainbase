import 'server-only';

import sql from '@/lib/db';
import { createEmployeeDocumentReminderEmailTransport } from './employeeDocumentReminderEmailTransport';
import { processDueEmployeeDocumentReminders } from './employeeDocumentReminderWorker';

type ReminderOrganisationRow = {
  organisation_id: string;
};

export type EmployeeDocumentReminderBatchSummary = {
  organisationsDiscovered: number;
  organisationsProcessed: number;
  organisationsFailed: number;
  discovered: number;
  claimed: number;
  discoverySkipped: number;
  sent: number;
  failed: number;
  ambiguous: number;
  transitionSkipped: number;
};

function utcIsoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Processes one bounded reminder batch for every active organisation that
 * currently has PENDING employee-document reminder deliveries.
 *
 * HR-7E5F intentionally uses the injected clock's UTC calendar date.
 * organisations.timezone is schema-only under Modular Platform Phase F.2A
 * and must not be consumed by application code until that capability is
 * separately activated.
 *
 * Tenant work is isolated: one organisation failing does not prevent the
 * remaining organisations from being processed. The caller receives counts
 * only; tenant ids, document ids, recipients, provider responses and secrets
 * are deliberately absent from the summary.
 */
export async function runEmployeeDocumentReminderBatch(params: {
  now?: Date;
  limitPerOrganisation?: number;
} = {}): Promise<EmployeeDocumentReminderBatchSummary> {
  const now = params.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error('now must be a valid Date.');
  }

  const scheduledThrough = utcIsoDate(now);

  const organisations = await sql`
    SELECT
      o.id AS organisation_id
    FROM organisations o
    WHERE o.status = 'ACTIVE'
      AND EXISTS (
        SELECT 1
        FROM hr_employee_document_reminder_deliveries r
        WHERE r.organisation_id = o.id
          AND r.delivery_status = 'PENDING'
      )
    ORDER BY o.id ASC
  ` as ReminderOrganisationRow[];

  const summary: EmployeeDocumentReminderBatchSummary = {
    organisationsDiscovered: organisations.length,
    organisationsProcessed: 0,
    organisationsFailed: 0,
    discovered: 0,
    claimed: 0,
    discoverySkipped: 0,
    sent: 0,
    failed: 0,
    ambiguous: 0,
    transitionSkipped: 0,
  };

  for (const organisation of organisations) {
    try {
      const result = await processDueEmployeeDocumentReminders({
        actor: {
          organisationId: organisation.organisation_id,
          userId: null,
        },
        scheduledThrough,
        limit: params.limitPerOrganisation,
        transport: createEmployeeDocumentReminderEmailTransport({
          organisationId: organisation.organisation_id,
        }),
      });

      summary.organisationsProcessed += 1;
      summary.discovered += result.discovered;
      summary.claimed += result.claimed;
      summary.discoverySkipped += result.discoverySkipped;
      summary.sent += result.sent;
      summary.failed += result.failed;
      summary.ambiguous += result.ambiguous;
      summary.transitionSkipped += result.transitionSkipped;
    } catch {
      summary.organisationsFailed += 1;
    }
  }

  return summary;
}
