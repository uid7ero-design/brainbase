import { NextResponse } from 'next/server';
import { runEmployeeDocumentReminderBatch } from '@/lib/hr/employeeDocumentReminderBatchExecutor';
import { countStaleEmployeeDocumentReminderClaims } from '@/lib/hr/employeeDocumentReminderRecoveryVisibility';
import { secureCompare } from '@/lib/secureCompare';

/**
 * GET /api/cron/hr-employee-document-reminders
 *
 * Runs one bounded employee-document reminder batch across active tenants.
 * Protected by CRON_SECRET using the repository's established cron-route
 * convention. The route returns aggregate counts only.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron/hr-employee-document-reminders] CRON_SECRET is not configured — refusing all requests.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = req.headers.get('authorization') ?? '';
  if (!secureCompare(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await runEmployeeDocumentReminderBatch();

    let staleClaimed: number | null = null;
    try {
      staleClaimed = await countStaleEmployeeDocumentReminderClaims();
    } catch {
      console.error('[hr cron/employee-document-reminders] stale-claim visibility unavailable');
    }

    const response = {
      ...summary,
      staleClaimed,
    };

    console.log(
      `[hr cron/employee-document-reminders] organisations_discovered=${summary.organisationsDiscovered} ` +
      `organisations_processed=${summary.organisationsProcessed} organisations_failed=${summary.organisationsFailed} ` +
      `discovered=${summary.discovered} claimed=${summary.claimed} sent=${summary.sent} failed=${summary.failed} ` +
      `ambiguous=${summary.ambiguous} discovery_skipped=${summary.discoverySkipped} ` +
      `transition_skipped=${summary.transitionSkipped} stale_claimed=${staleClaimed ?? 'unavailable'}`,
    );
    return NextResponse.json(response);
  } catch (error) {
    console.error('[hr cron/employee-document-reminders] fatal:', error);
    return NextResponse.json(
      { error: 'Employee document reminder run failed.' },
      { status: 500 },
    );
  }
}
