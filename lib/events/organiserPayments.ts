import 'server-only';
import sql from '@/lib/db';

// READ-ONLY organiser view of payment state, straight from the order rows'
// committed snapshot columns (ADR 0004). No Stripe call, no write, no fee
// recomputation. Every query is scoped by organisation_id AND joins events on
// the same organisation, so another tenant's order id can never be returned.
//
// "Payment-bearing" = payment_status <> 'NOT_REQUIRED' (free registrations
// have no payment to show).

export type PaymentOrderRow = {
  id: string;
  event_id: string;
  event_name: string;
  event_timezone: string | null;
  purchaser_name: string;
  purchaser_email: string | null;
  status: string;
  payment_status: string;
  currency: string | null;
  total_cents: number;
  discount_cents: number | null;
  platform_fee_cents: number | null;
  fee_mode: string | null;
  fee_label: string | null;
  payment_total_cents: number | null;
  refunded_cents: number | null;
  platform_fee_refunded_cents: number | null;
  created_at: string | Date;
  paid_at: string | Date | null;
  refunded_at: string | Date | null;
};

export type PaymentOrderLine = {
  description: string | null;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number | null;
};

// Bound on the rows one request reads. The caller reports truncation rather
// than silently summarising a partial set.
export const PAYMENT_ROW_CAP = 5000;

export async function listPaymentOrders(organisationId: string, eventId: string | null): Promise<{ rows: PaymentOrderRow[]; truncated: boolean }> {
  const rows = (await sql`
    SELECT
      eo.id, eo.event_id, e.name AS event_name, e.timezone AS event_timezone,
      eo.purchaser_name, eo.purchaser_email, eo.status, eo.payment_status, eo.currency,
      eo.total_cents, eo.discount_cents, eo.platform_fee_cents, eo.fee_mode, eo.fee_label,
      eo.payment_total_cents, eo.refunded_cents, eo.platform_fee_refunded_cents,
      eo.created_at, eo.paid_at, eo.refunded_at
    FROM event_orders eo
    JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
    WHERE eo.organisation_id = ${organisationId}
      AND eo.payment_status <> 'NOT_REQUIRED'
      AND (${eventId}::text IS NULL OR eo.event_id = ${eventId})
    ORDER BY eo.created_at DESC, eo.id
    LIMIT ${PAYMENT_ROW_CAP + 1}
  `) as PaymentOrderRow[];
  return { rows: rows.slice(0, PAYMENT_ROW_CAP), truncated: rows.length > PAYMENT_ROW_CAP };
}

export async function getPaymentOrder(
  organisationId: string,
  orderId: string,
): Promise<{ order: PaymentOrderRow; lines: PaymentOrderLine[] } | null> {
  const rows = (await sql`
    SELECT
      eo.id, eo.event_id, e.name AS event_name, e.timezone AS event_timezone,
      eo.purchaser_name, eo.purchaser_email, eo.status, eo.payment_status, eo.currency,
      eo.total_cents, eo.discount_cents, eo.platform_fee_cents, eo.fee_mode, eo.fee_label,
      eo.payment_total_cents, eo.refunded_cents, eo.platform_fee_refunded_cents,
      eo.created_at, eo.paid_at, eo.refunded_at
    FROM event_orders eo
    JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
    WHERE eo.id = ${orderId} AND eo.organisation_id = ${organisationId} AND eo.payment_status <> 'NOT_REQUIRED'
    LIMIT 1
  `) as PaymentOrderRow[];
  const order = rows[0];
  if (!order) return null;
  const lines = (await sql`
    SELECT tt.name AS description, li.quantity, li.unit_price_cents, li.discount_cents
    FROM event_order_items li
    LEFT JOIN event_ticket_types tt ON tt.id = li.ticket_type_id AND tt.organisation_id = li.organisation_id
    WHERE li.order_id = ${orderId} AND li.organisation_id = ${organisationId}
    ORDER BY li.created_at, li.id
  `) as PaymentOrderLine[];
  return { order, lines };
}
