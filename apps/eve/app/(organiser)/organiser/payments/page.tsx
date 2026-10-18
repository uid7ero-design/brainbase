import Link from 'next/link';
import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { Unavailable } from '@/components/ui/primitives';
import { ConnectPanel, StateBadge, STATE_LABEL, FEE_MODE_LABEL } from '@/components/organiser/PaymentParts';
import { requireOrganiser } from '@/lib/organiserAuth';
import { identityOf } from '@/lib/identity';
import { loadEvents, loadPayments } from '@/lib/organiserData';
import { formatAmount, formatDateTime } from '@/lib/format';
import type { PaymentState } from '@/lib/ticketing/gateway';

export const dynamic = 'force-dynamic';

const STATES: PaymentState[] = ['PAID', 'PENDING', 'FAILED', 'EXPIRED', 'REFUNDED'];
type Props = { searchParams: Promise<{ status?: string; event?: string }> };

function href(status: string | null, event: string | null): string {
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (event) qs.set('event', event);
  const s = qs.toString();
  return s ? `/organiser/payments?${s}` : '/organiser/payments';
}

// READ-ONLY: payment state as the ticketing API holds it (order
// snapshots and cached account state). No refund, payout or onboarding
// action exists on this page.
export default async function OrganiserPaymentsPage({ searchParams }: Props) {
  const { status: rawStatus, event: rawEvent } = await searchParams;
  const status = STATES.includes(rawStatus as PaymentState) ? (rawStatus as PaymentState) : null;
  const { token, session } = await requireOrganiser();
  const [events, data] = await Promise.all([
    loadEvents(token),
    loadPayments(token, { status: status ?? undefined, event: rawEvent || undefined }),
  ]);
  const eventId = data.filter.event;
  const totals = data.summary.currencies;
  return (
    <OrganiserShell title="Payments" identity={identityOf(session)}>
      <div className="space-y-6">
        <ConnectPanel connect={data.connect} />

        {totals.length === 0 ? (
          <Unavailable title="No payments yet" detail="Payment-bearing orders appear here once tickets with a price are ordered." />
        ) : (
          totals.map(t => (
            <section key={t.currency} aria-label={`Summary ${t.currency}`} data-testid={`summary-${t.currency}`}>
              <h2 className="mb-2 text-sm font-semibold text-eve-muted">{t.currency}</h2>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-eve-line bg-eve-surface p-4"><dt className="text-xs uppercase tracking-wider text-eve-muted">Paid revenue</dt><dd data-testid="paid-revenue" className="mt-1 text-xl font-semibold">{formatAmount(t.paid_revenue_cents, t.currency)}</dd><dd className="text-xs text-eve-muted">{t.counts.PAID} paid order{t.counts.PAID === 1 ? '' : 's'}</dd></div>
                <div className="rounded-lg border border-eve-line bg-eve-surface p-4"><dt className="text-xs uppercase tracking-wider text-eve-muted">Platform fees</dt><dd data-testid="platform-fees" className="mt-1 text-xl font-semibold">{formatAmount(t.platform_fees_cents, t.currency)}</dd><dd className="text-xs text-eve-muted">On paid orders</dd></div>
                <div className="rounded-lg border border-eve-line bg-eve-surface p-4"><dt className="text-xs uppercase tracking-wider text-eve-muted">Refunds</dt><dd data-testid="refunds" className="mt-1 text-xl font-semibold">{formatAmount(t.refunded_cents, t.currency)}</dd><dd className="text-xs text-eve-muted">{t.counts.REFUNDED} refunded order{t.counts.REFUNDED === 1 ? '' : 's'}</dd></div>
                <div className="rounded-lg border border-eve-line bg-eve-surface p-4"><dt className="text-xs uppercase tracking-wider text-eve-muted">Your share before processing fees</dt><dd data-testid="organiser-share" className="mt-1 text-xl font-semibold">{formatAmount(t.organiser_share_before_processing_cents, t.currency)}</dd><dd className="text-xs text-eve-muted">Paid orders only. Not a payout: payment-processing fees and payout timing are not included.</dd></div>
              </dl>
              <p className="mt-2 text-sm text-eve-muted" data-testid="state-counts">
                Pending {t.counts.PENDING} · Failed {t.counts.FAILED} · Expired {t.counts.EXPIRED}
              </p>
            </section>
          ))
        )}
        {!data.summary.complete ? <p role="status" className="text-sm text-eve-muted">Totals cover only the most recent orders; this organisation has more than the page can summarise.</p> : null}

        <div className="flex flex-wrap items-end gap-4">
          <nav aria-label="Payment state" className="flex flex-wrap gap-2">
            <Link href={href(null, eventId)} aria-current={status ? undefined : 'page'} className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold ${status ? 'border-eve-line' : 'border-eve-ink bg-eve-ink text-white'}`}>All</Link>
            {STATES.map(s => (
              <Link key={s} href={href(s, eventId)} aria-current={status === s ? 'page' : undefined} className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold ${status === s ? 'border-eve-ink bg-eve-ink text-white' : 'border-eve-line'}`}>{STATE_LABEL[s]}</Link>
            ))}
          </nav>
          <form method="get" className="flex items-end gap-3">
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <div>
              <label htmlFor="event" className="block text-sm font-medium">Event</label>
              <select id="event" name="event" defaultValue={eventId ?? ''} className="mt-1 min-h-11 rounded-lg border border-eve-line bg-white px-3 text-sm">
                <option value="">All events</option>
                {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <button type="submit" className="min-h-11 rounded-full border border-eve-line px-4 text-sm font-semibold">Filter</button>
          </form>
        </div>

        {data.orders.length === 0 ? (
          <Unavailable title={status ? `No ${STATE_LABEL[status].toLowerCase()} payments` : 'No payments to show'} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-eve-line bg-eve-surface">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Payment-bearing orders</caption>
              <thead className="bg-eve-surface-alt text-xs uppercase tracking-wider text-eve-muted">
                <tr><th scope="col" className="p-3">Order</th><th scope="col" className="p-3">Event</th><th scope="col" className="p-3">Purchaser</th><th scope="col" className="p-3">Date</th><th scope="col" className="p-3">State</th><th scope="col" className="p-3">Amount</th><th scope="col" className="p-3">Fee</th><th scope="col" className="p-3">Refunded</th></tr>
              </thead>
              <tbody>
                {data.orders.map(o => (
                  <tr key={o.id} className="border-t border-eve-line" data-testid={`row-${o.id}`}>
                    <th scope="row" className="p-3 font-medium"><Link className="text-eve-accent underline" href={`/organiser/payments/${o.id}`}>{o.id.slice(0, 8)}</Link></th>
                    <td className="p-3">{o.event.name}</td>
                    <td className="p-3">{o.purchaser_name}{o.purchaser_email ? <span className="block text-xs text-eve-muted">{o.purchaser_email}</span> : null}</td>
                    <td className="p-3">{formatDateTime(o.paid_at ?? o.created_at, o.event.timezone)}</td>
                    <td className="p-3"><StateBadge state={o.payment_state} /></td>
                    <td className="p-3">{formatAmount(o.payment_total_cents, o.currency)}</td>
                    <td className="p-3">{o.platform_fee_cents > 0 && o.fee_mode ? <>{formatAmount(o.platform_fee_cents, o.currency)}<span className="block text-xs text-eve-muted">{FEE_MODE_LABEL[o.fee_mode]}</span></> : 'None'}</td>
                    <td className="p-3">{o.refunded_amount_cents !== null ? formatAmount(o.refunded_amount_cents, o.currency) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.orders_truncated ? <p role="status" className="text-sm text-eve-muted">Showing the most recent {data.orders.length} orders for this filter.</p> : null}
        <p className="text-sm text-eve-muted">This page is read-only. Refunds, payouts and Stripe account setup are not available in Eve yet.</p>
      </div>
    </OrganiserShell>
  );
}
