import type {
  EmployeeDocumentReminderActor,
  EmployeeDocumentReminderDelivery,
} from './employeeDocumentReminderDeliveryMutations';
import {
  markEmployeeDocumentReminderDeliveryFailed,
  markEmployeeDocumentReminderDeliverySent,
} from './employeeDocumentReminderDeliveryMutations';
import { claimDueEmployeeDocumentReminders } from './employeeDocumentReminderQueue';

export type EmployeeDocumentReminderTransportResult =
  | { outcome: 'sent' }
  | { outcome: 'definite_failure'; failureCode: string }
  | { outcome: 'ambiguous'; failureCode?: string };

export type EmployeeDocumentReminderTransport = (
  delivery: EmployeeDocumentReminderDelivery,
) => Promise<EmployeeDocumentReminderTransportResult>;

export type EmployeeDocumentReminderWorkerResult = {
  discovered: number;
  claimed: number;
  discoverySkipped: number;
  sent: number;
  failed: number;
  ambiguous: number;
  transitionSkipped: number;
};

/**
 * Processes one bounded batch of due reminders. Transport is injected so this
 * orchestration can be proven without sending real email or coupling HR to one
 * provider.
 *
 * A thrown transport error is treated as ambiguous: the delivery remains
 * CLAIMED because the provider may have accepted it before the network error.
 * That avoids incorrectly marking the row FAILED and later double-sending.
 */
export async function processDueEmployeeDocumentReminders(params: {
  actor: EmployeeDocumentReminderActor;
  scheduledThrough: string;
  transport: EmployeeDocumentReminderTransport;
  limit?: number;
}): Promise<EmployeeDocumentReminderWorkerResult> {
  const batch = await claimDueEmployeeDocumentReminders({
    actor: params.actor,
    scheduledThrough: params.scheduledThrough,
    limit: params.limit,
  });

  let sent = 0;
  let failed = 0;
  let ambiguous = 0;
  let transitionSkipped = 0;

  for (const delivery of batch.claimed) {
    let transportResult: EmployeeDocumentReminderTransportResult;

    try {
      transportResult = await params.transport(delivery);
    } catch {
      ambiguous += 1;
      continue;
    }

    if (transportResult.outcome === 'ambiguous') {
      ambiguous += 1;
      continue;
    }

    if (transportResult.outcome === 'sent') {
      const transition = await markEmployeeDocumentReminderDeliverySent({
        actor: params.actor,
        deliveryId: delivery.id,
      });

      if (transition.outcome === 'recorded') {
        sent += 1;
      } else {
        transitionSkipped += 1;
      }
      continue;
    }

    const failureCode = transportResult.failureCode.trim();
    if (!failureCode) {
      throw new Error('Transport definite failure must include a non-blank failureCode.');
    }

    const transition = await markEmployeeDocumentReminderDeliveryFailed({
      actor: params.actor,
      deliveryId: delivery.id,
      failureCode,
    });

    if (transition.outcome === 'recorded') {
      failed += 1;
    } else {
      transitionSkipped += 1;
    }
  }

  return {
    discovered: batch.discovered,
    claimed: batch.claimed.length,
    discoverySkipped: batch.skipped,
    sent,
    failed,
    ambiguous,
    transitionSkipped,
  };
}
