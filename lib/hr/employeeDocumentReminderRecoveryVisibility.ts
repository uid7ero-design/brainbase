import 'server-only';

import sql from '@/lib/db';

// Deliberately far beyond the 10-second provider timeout and normal immediate
// claim-to-terminal transition. A row older than this is operationally stale,
// but its provider outcome is still unknown and must not be guessed.
export const EMPLOYEE_DOCUMENT_REMINDER_STALE_CLAIM_MINUTES = 30;

/**
 * Counts employee-document reminder deliveries that have remained CLAIMED
 * beyond the stale threshold.
 *
 * This is visibility only. It never changes delivery state and never re-sends:
 * an ambiguous transport failure can mean the provider accepted the message
 * even though BrainBase did not receive the response.
 */
export async function countStaleEmployeeDocumentReminderClaims(): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS stale_claimed
    FROM hr_employee_document_reminder_deliveries
    WHERE delivery_status = 'CLAIMED'
      AND claimed_at IS NOT NULL
      AND claimed_at < NOW() - make_interval(
        mins => ${EMPLOYEE_DOCUMENT_REMINDER_STALE_CLAIM_MINUTES}
      )
  ` as Array<{ stale_claimed: number }>;

  const count = rows[0]?.stale_claimed;
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('Employee document reminder stale-claim count returned invalid state.');
  }

  return count;
}
