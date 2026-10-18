import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { StateBadge, FEE_MODE_LABEL } from '@/components/organiser/PaymentParts';
import { requireOrganiser } from '@/lib/organiserAuth';
import { identityOf } from '@/lib/identity';
import { loadPayment } from '@/lib/organiserData';
import { formatAmount, formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ orderId: string }> };

// READ-ONLY order payment detail. An order that is not this organisation's
// (or is not payment-bearing) is the same not-found as an unknown id.
export default async function OrganiserPaymentDetailPage({ params }: Props) {
  const { orderId } = await params;
  const { token, session } = await requireOrganiser();
  const detail = await loadPayment(token, orderId);
  if (!detail) notFound();
  const o = detail.order;
  const money = (c: number) => formatAmount(c, o.currency);
  const rows: [string, string, string?][] = [
    ['Ticket total', money(o.ticket_total_cents)],
    ...(o.discount_cents > 0 ? [['Discount applied', money(o.discount_cents)] as [string, string]] : []),
    ['Platform fee', o.platform_fee_cents > 0 && o.fee_mode ? `${money(o.platform_fee_cents)} · ${FEE_MODE_LABEL[o.fee_mode]}` : 'None'],
    ['Charged to the buyer', money(o.payment_total_cents), 'charged'],
  ];
  if (o.refunded_amount_cents !== null) rows.push(['Refunded', money(o.refunded_amount_cents), 'refunded']);
  if (o.platform_fee_refunded_cents !== null) rows.push(['Platform fee refunded', money(o.platform_fee_refunded_cents)]);
  if (o.organiser_share_before_processing_cents !== null) rows.push(['Your share before processing fees', money(o.organiser_share_before_processing_cents), 'share']);
  return (
    <OrganiserShell title="Payment" identity={identityOf(session)}>
      <div className="max-w-3xl space-y-6">
        <p><Link className="text-sm text-eve-accent underline" href="/organiser/payments">← All payments</Link></p>
        <section className="rounded-lg border border-eve-line bg-eve-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Order {o.id}</h2>
            <StateBadge state={o.payment_state} />
          </div>
          <p className="mt-1 text-sm text-eve-muted">{o.event.name} · {o.purchaser_name}{o.purchaser_email ? ` · ${o.purchaser_email}` : ''}</p>
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {rows.map(([k, v, id]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-eve-line py-1"><dt className="text-eve-muted">{k}</dt><dd data-testid={id} className="font-medium">{v}</dd></div>
            ))}
          </dl>
          <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <div><dt className="text-eve-muted">Placed</dt><dd>{formatDateTime(o.created_at, o.event.timezone) || '—'}</dd></div>
            <div><dt className="text-eve-muted">Paid</dt><dd>{formatDateTime(o.paid_at, o.event.timezone) || '—'}</dd></div>
            <div><dt className="text-eve-muted">Refunded</dt><dd>{formatDateTime(o.refunded_at, o.event.timezone) || '—'}</dd></div>
          </dl>
        </section>
        {detail.lines.length ? (
          <div className="overflow-x-auto rounded-lg border border-eve-line bg-eve-surface">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Order lines</caption>
              <thead className="bg-eve-surface-alt text-xs uppercase tracking-wider text-eve-muted"><tr><th scope="col" className="p-3">Ticket</th><th scope="col" className="p-3">Qty</th><th scope="col" className="p-3">Unit price</th><th scope="col" className="p-3">Discount</th></tr></thead>
              <tbody>
                {detail.lines.map((l, i) => (
                  <tr key={i} className="border-t border-eve-line"><th scope="row" className="p-3 font-medium">{l.description}</th><td className="p-3">{l.quantity}</td><td className="p-3">{money(l.unit_price_cents)}</td><td className="p-3">{l.discount_cents > 0 ? money(l.discount_cents) : '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="text-sm text-eve-muted">Read-only. Your share excludes payment-processing fees and is not a payout.</p>
      </div>
    </OrganiserShell>
  );
}
