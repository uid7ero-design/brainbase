import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { EventPicker } from '@/components/organiser/EventPicker';
import { Unavailable } from '@/components/ui/primitives';
import { requireOrganiser } from '@/lib/organiserAuth';
import { identityOf } from '@/lib/identity';
import { loadEvents, loadOrders, pickEvent } from '@/lib/organiserData';
import { formatAmount, formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ event?: string }> };

export default async function OrganiserOrdersPage({ searchParams }: Props) {
  const { event: requested } = await searchParams;
  const { token, session } = await requireOrganiser();
  const events = await loadEvents(token);
  const event = pickEvent(events, requested);
  const orders = event ? await loadOrders(token, event.id) : [];
  return (
    <OrganiserShell title="Orders" identity={identityOf(session)}>
      {!event ? (
        <Unavailable title="No events yet" detail="Orders appear here once an event has registrations." />
      ) : (
        <div className="space-y-6">
          <EventPicker events={events} selectedId={event.id} />
          {orders.length === 0 ? (
            <Unavailable title="No orders for this event yet" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-eve-line bg-eve-surface">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Orders for {event.name}</caption>
                <thead className="bg-eve-surface-alt text-xs uppercase tracking-wider text-eve-muted">
                  <tr><th scope="col" className="p-3">Purchaser</th><th scope="col" className="p-3">Tickets</th><th scope="col" className="p-3">Payment</th><th scope="col" className="p-3">Order</th><th scope="col" className="p-3">Paid</th><th scope="col" className="p-3">Placed</th></tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.id} className="border-t border-eve-line">
                      <th scope="row" className="p-3 font-medium">{o.purchaser_name}<span className="block text-xs font-normal text-eve-muted">{o.purchaser_email}</span></th>
                      <td className="p-3">{o.lines.map((l, i) => <span key={i} className="block">{l.quantity} × {l.ticket_type_name ?? 'Ticket'}{l.session_name ? ` (${l.session_name})` : ''}</span>)}</td>
                      <td className="p-3">{o.payment_status}</td>
                      <td className="p-3">{o.status}</td>
                      <td className="p-3">{formatAmount(o.payment_total_cents ?? o.total_cents, o.currency)}</td>
                      <td className="p-3">{formatDateTime(o.created_at, event.timezone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </OrganiserShell>
  );
}
