import sql from '@/lib/db';

export const OVERVIEW_EVENT_CAP = 25;

export async function readWorkspaceEvents(organisationId: string) {
  // Independent counts avoid multiplying session rows by ticket-type rows.
  // Project only the fields the Eve event picker and list actually consume.
  return sql`
    SELECT e.id,e.name,e.slug,e.status,e.venue,e.starts_at,e.ends_at,e.timezone,
      (SELECT count(*)::int FROM event_sessions s WHERE s.event_id=e.id AND s.organisation_id=${organisationId}) AS session_count,
      (SELECT count(*)::int FROM event_ticket_types t WHERE t.event_id=e.id AND t.organisation_id=${organisationId}) AS ticket_type_count
    FROM events e WHERE e.organisation_id=${organisationId}
    ORDER BY e.starts_at DESC
  `;
}

// Counts only. Do not fetch purchaser details, tickets or registration answers
// just to render dashboard totals. Match the existing order-item-backed lists.
export async function readOrganiserOverview(organisationId: string, eventIds: string[]) {
  const selected = JSON.stringify(eventIds.slice(0, OVERVIEW_EVENT_CAP));
  const rows = await sql`
    WITH selected_events AS (
      SELECT id FROM events
      WHERE organisation_id = ${organisationId}
        AND id IN (SELECT jsonb_array_elements_text(${selected}::jsonb))
    ), live_orders AS (
      SELECT o.id, o.payment_status FROM event_orders o
      WHERE o.organisation_id = ${organisationId}
        AND o.event_id IN (SELECT id FROM selected_events)
        AND o.status IS DISTINCT FROM 'CANCELLED'
        AND EXISTS (SELECT 1 FROM event_order_items i
                    WHERE i.order_id = o.id AND i.organisation_id = ${organisationId})
    ), live_attendees AS (
      SELECT a.checked_in_at FROM event_attendees a
      JOIN event_order_items i ON i.id = a.order_item_id AND i.organisation_id = ${organisationId}
      JOIN live_orders o ON o.id = i.order_id
      WHERE a.organisation_id = ${organisationId}
    )
    SELECT (SELECT count(*)::text FROM live_orders) AS order_count,
           (SELECT count(*)::text FROM live_orders WHERE payment_status = 'PAID') AS paid_order_count,
           (SELECT count(*)::text FROM live_attendees) AS ticket_count,
           (SELECT count(*)::text FROM live_attendees WHERE checked_in_at IS NOT NULL) AS checked_in_count
  `;
  const row = rows[0];
  const count = (key: string) => {
    const raw = row?.[key];
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new Error('Invalid organiser overview count.');
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new Error('Invalid organiser overview count.');
    return value;
  };
  return { orderCount: count('order_count'), paidOrderCount: count('paid_order_count'), ticketCount: count('ticket_count'), checkedInCount: count('checked_in_count') };
}
