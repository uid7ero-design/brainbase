// Phase 2 — multi-ticket-type orders. The organiser orders API
// (app/api/events/[id]/orders/route.ts) returns one row per order ITEM
// — a deliberate, unchanged grain that its filters and CSV export rely
// on. A multi-ticket-type order therefore arrives as several rows that
// share one order id. Order-level facts — purchaser, amount, payment and
// order status, the refund/cancel/retry actions, booking-level answers —
// must be shown (and actionable) exactly once per order, so the panel
// folds rows into one display entry per order with one `line` per item.
//
// Pure and dependency-free so the folding rule is unit-testable.

export type GroupableAttendee = { id: string };

export type GroupableOrderRow<A extends GroupableAttendee> = {
  id: string;
  order_item_id: string;
  ticket_type_name: string | null;
  quantity: number;
  attendees: A[];
};

export type OrderLine = { order_item_id: string; ticket_type_name: string | null; quantity: number };

export type GroupedOrder<R extends GroupableOrderRow<GroupableAttendee>> = Omit<R, 'attendees'> & {
  // One entry per order item, in the order the rows arrived.
  lines: OrderLine[];
  // Every attendee across every line, each tagged with its own line's
  // ticket type name.
  attendees: (R['attendees'][number] & { ticket_type_name: string | null })[];
};

// Preserves the API's own ordering (first appearance of each order id);
// order-level fields are taken from the first row of each order (they
// are identical across that order's rows by construction — they are
// event_orders columns); quantity becomes the order's total.
export function groupOrderRows<R extends GroupableOrderRow<GroupableAttendee>>(rows: R[]): GroupedOrder<R>[] {
  const byId = new Map<string, GroupedOrder<R>>();
  const out: GroupedOrder<R>[] = [];
  for (const row of rows) {
    const line: OrderLine = { order_item_id: row.order_item_id, ticket_type_name: row.ticket_type_name, quantity: row.quantity };
    const tagged = row.attendees.map(a => ({ ...a, ticket_type_name: row.ticket_type_name }));
    const existing = byId.get(row.id);
    if (existing) {
      existing.lines.push(line);
      existing.attendees.push(...tagged);
      existing.quantity += row.quantity;
      continue;
    }
    const grouped: GroupedOrder<R> = { ...row, lines: [line], attendees: tagged };
    byId.set(row.id, grouped);
    out.push(grouped);
  }
  return out;
}

export function formatOrderLines(lines: OrderLine[]): string {
  return lines.map(l => `${l.ticket_type_name ?? 'Unknown ticket type'} × ${l.quantity}`).join(', ');
}
