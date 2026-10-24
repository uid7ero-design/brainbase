import Link from 'next/link';
import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { Unavailable } from '@/components/ui/primitives';
import { requireOrganiser } from '@/lib/organiserAuth';
import { identityOf } from '@/lib/identity';
import { loadEvents } from '@/lib/organiserData';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function OrganiserEventsPage() {
  const { token, session } = await requireOrganiser();
  const events = await loadEvents(token);
  return (
    <OrganiserShell title="Events" identity={identityOf(session)}>
      {events.length === 0 ? (
        <Unavailable title="No events yet" detail="Events created for this organisation will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-eve-line bg-eve-surface">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Events</caption>
            <thead className="bg-eve-surface-alt text-xs uppercase tracking-wider text-eve-muted">
              <tr><th scope="col" className="p-3">Event</th><th scope="col" className="p-3">Status</th><th scope="col" className="p-3">Starts</th><th scope="col" className="p-3">Sessions</th><th scope="col" className="p-3">Ticket types</th><th scope="col" className="p-3">Public page</th></tr>
            </thead>
            <tbody>
              {events.map(e => (
                <tr key={e.id} className="border-t border-eve-line">
                  <th scope="row" className="p-3 font-medium">{e.name}</th>
                  <td className="p-3">{e.status}</td>
                  <td className="p-3">{formatDateTime(e.starts_at, e.timezone)}</td>
                  <td className="p-3">{e.session_count}</td>
                  <td className="p-3">{e.ticket_type_count}</td>
                  <td className="p-3">{e.status === 'PUBLISHED' ? <Link className="text-eve-accent underline" href={`/e/${session.organisation.slug}/${e.slug}`}>View</Link> : <span className="text-eve-muted">Not published</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </OrganiserShell>
  );
}
