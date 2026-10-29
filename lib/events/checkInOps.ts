import sql from '@/lib/db';
import { confirmCheckIn, undoCheckIn, type AttendeeIdentifier } from '@/lib/events/checkIn';
import { logCheckedIn, logCheckInUndone } from '@/lib/events/auditLog';

// Check-in operations with their audit-log side effect, shared by the
// BrainBase check-in routes and the standalone ticketing API so the
// behaviour (state change + audit entry) is one implementation. No
// authorization here: callers authorize and pass their own organisationId
// and userId.

export async function eventBelongsToOrganisation(organisationId: string, eventId: string): Promise<boolean> {
  const rows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  return rows.length > 0;
}

export async function confirmCheckInWithAudit(
  organisationId: string,
  eventId: string,
  identifier: AttendeeIdentifier,
  userId: string,
) {
  const result = await confirmCheckIn(organisationId, eventId, identifier, userId);
  if (result.ok && result.first) {
    const orderRows = await sql`SELECT order_id FROM event_attendees WHERE id = ${result.attendee.id} AND organisation_id = ${organisationId} LIMIT 1`;
    const orderId = (orderRows[0] as { order_id: string } | undefined)?.order_id;
    if (orderId) await logCheckedIn({ organisationId, userId, orderId, attendeeId: result.attendee.id });
  }
  return result;
}

export async function undoCheckInWithAudit(organisationId: string, eventId: string, attendeeId: string, userId: string) {
  const result = await undoCheckIn(organisationId, eventId, attendeeId);
  if (result.ok) {
    const orderRows = await sql`SELECT order_id FROM event_attendees WHERE id = ${attendeeId} AND organisation_id = ${organisationId} LIMIT 1`;
    const orderId = (orderRows[0] as { order_id: string } | undefined)?.order_id;
    if (orderId) await logCheckInUndone({ organisationId, userId, orderId, attendeeId });
  }
  return result;
}
