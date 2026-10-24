// Phase 5A — neutral PAYMENT RECEIPT model (brief §9). Pure: no
// 'server-only', no DB, no provider. Builds the factual financial summary
// of one paid order from the order's OWN committed snapshot columns and
// renders it as an email-safe HTML fragment.
//
// What this deliberately IS NOT (see docs/architecture/decisions/
// 0004-ticketing-fees-and-gst-foundation.md §"Receipt / invoice"):
//   * not a tax invoice — no "Tax Invoice" heading, no GST line, no ABN,
//     no supplier identification beyond the event's organiser name. The
//     supplier of the TICKET is the organiser (Stripe direct charge on the
//     connected account); the supplier of a PLATFORM FEE is a business/
//     accounting decision still outstanding, so this receipt names
//     neither as a supplier and makes no tax claim whatsoever;
//   * not a credit note — a refund is recorded as a factual line only.
// Every figure is integer cents formatted at the edge (ADR 0002 §10);
// every string is escaped by the caller-supplied escaper (lib/email.ts's
// escHtml — injected so this module stays dependency-free and testable).

export type PaymentReceiptLine = {
  description: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
};

export type PaymentReceiptOrder = {
  // Public order reference: the order id (what the organiser's export and
  // the Stripe metadata already use). Never a Stripe id.
  order_reference: string;
  event_name: string;
  organiser_name: string;
  currency: string;
  total_cents: number;                 // NET ticket amount (gross − discount)
  discount_cents: number;
  promotion_code_snapshot: string | null;
  platform_fee_cents: number;
  fee_mode: 'PASS_THROUGH' | 'ABSORB' | null;
  fee_label: string | null;
  payment_total_cents: number | null;  // NULL only on a pre-Phase-5A row
  paid_at: string | Date | null;
  payment_status: string;
  refunded_cents: number | null;
  refunded_at: string | Date | null;
  lines: PaymentReceiptLine[];
  // The event's IANA timezone (events.timezone). Paid/refunded dates are
  // shown as the buyer's local calendar date there, never the server's
  // (UTC on Vercel), so an 8 am Adelaide payment is not dated the day before.
  time_zone?: string | null;
};

export type PaymentReceipt = {
  order_reference: string;
  event_name: string;
  organiser_name: string;
  currency: string;
  lines: PaymentReceiptLine[];
  gross_ticket_cents: number;
  discount_cents: number;
  promotion_code: string | null;
  net_ticket_cents: number;
  // Only a PASS_THROUGH fee is a purchaser-facing line (they paid it); an
  // ABSORB fee is between the organiser and the platform and never
  // appears on a purchaser's receipt.
  booking_fee_cents: number;
  booking_fee_label: string | null;
  total_paid_cents: number;
  paid_at: string | null;
  refunded_cents: number | null;
  refunded_at: string | null;
  time_zone: string | null;
};

function assertCents(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${what} must be a non-negative safe integer (got ${value}).`);
}

function toIso(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Factual values only; throws (never guesses) when the stored snapshot
// does not reconcile — a receipt must never present arithmetic the order
// row itself contradicts.
export function buildPaymentReceipt(order: PaymentReceiptOrder): PaymentReceipt {
  assertCents(order.total_cents, 'total_cents');
  assertCents(order.discount_cents, 'discount_cents');
  assertCents(order.platform_fee_cents, 'platform_fee_cents');
  const totalPaid = order.payment_total_cents ?? order.total_cents;
  assertCents(totalPaid, 'payment_total_cents');
  const passThrough = order.fee_mode === 'PASS_THROUGH';
  const bookingFeeCents = passThrough ? order.platform_fee_cents : 0;
  if (passThrough && totalPaid !== order.total_cents + order.platform_fee_cents) {
    throw new Error('Receipt refused: payment total does not equal ticket total plus the pass-through fee.');
  }
  if (!passThrough && totalPaid !== order.total_cents) {
    throw new Error('Receipt refused: payment total does not equal the ticket total.');
  }
  const lineGross = order.lines.reduce((sum, l) => {
    assertCents(l.quantity, 'quantity'); assertCents(l.unit_price_cents, 'unit_price_cents'); assertCents(l.discount_cents, 'line discount_cents');
    return sum + l.unit_price_cents * l.quantity;
  }, 0);
  const lineDiscount = order.lines.reduce((sum, l) => sum + l.discount_cents, 0);
  if (order.lines.length && (lineGross !== order.total_cents + order.discount_cents || lineDiscount !== order.discount_cents)) {
    throw new Error('Receipt refused: order lines do not reconcile with the order totals.');
  }
  if (order.refunded_cents !== null) assertCents(order.refunded_cents, 'refunded_cents');
  return {
    order_reference: order.order_reference,
    event_name: order.event_name,
    organiser_name: order.organiser_name,
    currency: order.currency.toUpperCase(),
    lines: order.lines.map(l => ({ ...l })),
    gross_ticket_cents: order.total_cents + order.discount_cents,
    discount_cents: order.discount_cents,
    promotion_code: order.promotion_code_snapshot,
    net_ticket_cents: order.total_cents,
    booking_fee_cents: bookingFeeCents,
    booking_fee_label: bookingFeeCents > 0 ? (order.fee_label ?? 'Booking fee') : null,
    total_paid_cents: totalPaid,
    paid_at: toIso(order.paid_at),
    refunded_cents: order.payment_status === 'REFUNDED' ? (order.refunded_cents ?? totalPaid) : null,
    refunded_at: order.payment_status === 'REFUNDED' ? toIso(order.refunded_at) : null,
    time_zone: order.time_zone ?? null,
  };
}

// The widened order row the two ticket-email callers read (manual resend
// route, automatic delivery). Every Phase 5A field is optional: a
// pre-Phase-5A fixture/row, or a payload that never selected them, simply
// yields no receipt — the ticket email then renders exactly as before.
export type ReceiptOrderRow = {
  id: string;
  payment_status?: string | null;
  event_name: string;
  organisation_name?: string | null;
  currency?: string | null;
  total_cents?: number | null;
  discount_cents?: number | null;
  promotion_code_snapshot?: string | null;
  platform_fee_cents?: number | null;
  fee_mode?: string | null;
  fee_label?: string | null;
  payment_total_cents?: number | null;
  paid_at?: string | Date | null;
  refunded_cents?: number | null;
  refunded_at?: string | Date | null;
  event_timezone?: string | null;
  receipt_lines?: { description: string | null; quantity: number; unit_price_cents: number; discount_cents: number | null }[] | null;
};

// A receipt exists only for an order that was actually PAID (or paid then
// REFUNDED) — a free (NOT_REQUIRED) or PENDING order has no payment to
// summarise. Never throws: a row that cannot be reconciled logs and yields
// null so the ticket email itself is never blocked by its summary.
export function receiptFromOrderRow(row: ReceiptOrderRow): PaymentReceipt | null {
  if (row.payment_status !== 'PAID' && row.payment_status !== 'REFUNDED') return null;
  if (typeof row.total_cents !== 'number') return null;
  try {
    return buildPaymentReceipt({
      order_reference: row.id,
      event_name: row.event_name,
      organiser_name: row.organisation_name ?? '',
      currency: row.currency ?? 'AUD',
      total_cents: row.total_cents,
      discount_cents: row.discount_cents ?? 0,
      promotion_code_snapshot: row.promotion_code_snapshot ?? null,
      platform_fee_cents: row.platform_fee_cents ?? 0,
      fee_mode: row.fee_mode === 'PASS_THROUGH' || row.fee_mode === 'ABSORB' ? row.fee_mode : null,
      fee_label: row.fee_label ?? null,
      payment_total_cents: row.payment_total_cents ?? null,
      paid_at: row.paid_at ?? null,
      payment_status: row.payment_status,
      refunded_cents: row.refunded_cents ?? null,
      refunded_at: row.refunded_at ?? null,
      time_zone: row.event_timezone ?? null,
      lines: (row.receipt_lines ?? []).map(l => ({
        description: l.description ?? 'Ticket',
        quantity: l.quantity,
        unit_price_cents: l.unit_price_cents,
        discount_cents: l.discount_cents ?? 0,
      })),
    });
  } catch (err) {
    console.error('[events receipt] payment summary omitted: order snapshot did not reconcile', err, { orderId: row.id });
    return null;
  }
}

export function formatReceiptMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

// A calendar date ("23 Oct 2026") in `timeZone` when it is a valid IANA
// zone. Without one (a legacy caller) it keeps the previous behaviour: the
// runtime's own zone.
export function formatReceiptDate(iso: string, timeZone: string | null | undefined): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
  if (timeZone) {
    try {
      return d.toLocaleDateString('en-AU', { ...opts, timeZone });
    } catch {
      // Unknown zone: fall through to the runtime default rather than drop the date.
    }
  }
  return d.toLocaleDateString('en-AU', opts);
}

// Words this receipt must never contain (asserted by the containment
// suite): it is not a tax document and makes no tax claim.
export const RECEIPT_FORBIDDEN_TERMS: readonly string[] = ['Tax Invoice', 'GST', 'ABN', 'tax invoice'];

// Email-safe HTML fragment (inline styles only, table layout). `esc` is
// the caller's HTML escaper. Heading is "Payment summary" — deliberately
// not "Receipt" in a legal sense and never "Tax Invoice".
export function renderPaymentReceiptHtml(receipt: PaymentReceipt, esc: (s: string) => string): string {
  const money = (c: number) => esc(formatReceiptMoney(c, receipt.currency));
  const row = (label: string, value: string, strong = false) => `
      <tr>
        <td style="padding:4px 0;color:${strong ? '#111' : '#555'};font-size:13px;${strong ? 'font-weight:700' : ''}">${label}</td>
        <td style="padding:4px 0;color:${strong ? '#111' : '#555'};font-size:13px;text-align:right;${strong ? 'font-weight:700' : ''}">${value}</td>
      </tr>`;
  const lineRows = receipt.lines.map(l => {
    const lineTotal = l.unit_price_cents * l.quantity - l.discount_cents;
    const detail = l.discount_cents > 0
      ? `${l.quantity} × ${money(l.unit_price_cents)}, less ${money(l.discount_cents)} discount`
      : `${l.quantity} × ${money(l.unit_price_cents)}`;
    return row(`${esc(l.description)}<br><span style="color:#888;font-size:12px">${detail}</span>`, money(lineTotal));
  }).join('');
  const paidOn = receipt.paid_at ? formatReceiptDate(receipt.paid_at, receipt.time_zone) : null;
  const refundedOn = receipt.refunded_at ? formatReceiptDate(receipt.refunded_at, receipt.time_zone) : null;
  return `
    <div style="margin:24px 0 0;padding:16px 0 0;border-top:1px solid #f0f0f0">
      <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.04em">Payment summary</p>
      <p style="margin:0 0 10px;font-size:12px;color:#888">Order ${esc(receipt.order_reference)} · ${esc(receipt.event_name)} · ${esc(receipt.organiser_name)}${paidOn ? ` · Paid ${esc(paidOn)}` : ''}</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
        ${lineRows}
        ${receipt.discount_cents > 0 && !receipt.lines.length ? row(`Discount${receipt.promotion_code ? ` (${esc(receipt.promotion_code)})` : ''}`, `−${money(receipt.discount_cents)}`) : ''}
        ${receipt.booking_fee_cents > 0 ? row(esc(receipt.booking_fee_label ?? 'Booking fee'), money(receipt.booking_fee_cents)) : ''}
        ${row(`Total paid (${esc(receipt.currency)})`, money(receipt.total_paid_cents), true)}
        ${receipt.refunded_cents !== null ? row(`Refunded${refundedOn ? ` ${esc(refundedOn)}` : ''}`, `−${money(receipt.refunded_cents)}`) : ''}
      </table>
    </div>`;
}
