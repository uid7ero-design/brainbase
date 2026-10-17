import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { Card, Unavailable } from '@/components/ui/primitives';
import { requireOrganiser } from '@/lib/organiserAuth';
import { identityOf } from '@/lib/identity';
import { loadEvents, loadOverview } from '@/lib/organiserData';

export const dynamic = 'force-dynamic';

export default async function OrganiserDashboardPage() {
  const { token, session } = await requireOrganiser();
  const events = await loadEvents(token);
  const o = await loadOverview(token, events);
  const tiles: [string, number][] = [
    ['Events', o.eventCount], ['Published', o.publishedCount], ['Orders', o.orderCount],
    ['Paid orders', o.paidOrderCount], ['Tickets', o.ticketCount], ['Checked in', o.checkedInCount],
  ];
  return (
    <OrganiserShell title="Dashboard" identity={identityOf(session)}>
      {events.length === 0 ? (
        <Unavailable title="No events yet" detail="Events created for this organisation will appear here." />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {tiles.map(([label, value]) => (
              <Card key={label} className="p-4">
                <dt className="text-xs font-semibold uppercase tracking-wider text-eve-muted">{label}</dt>
                <dd className="mt-1 text-3xl font-semibold" data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}>{value}</dd>
              </Card>
            ))}
          </dl>
          {o.truncated ? <p className="mt-3 text-xs text-eve-muted">Order and ticket counts cover the 25 most recent events.</p> : null}
        </>
      )}
    </OrganiserShell>
  );
}
