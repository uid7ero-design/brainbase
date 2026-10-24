import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { EventPicker } from '@/components/organiser/EventPicker';
import { Unavailable } from '@/components/ui/primitives';
import { requireOrganiser } from '@/lib/organiserAuth';
import { identityOf } from '@/lib/identity';
import { loadAttendees, loadEvents, pickEvent } from '@/lib/organiserData';
import { formatDateTime } from '@/lib/format';
import { RecordedAnswers } from '@/components/organiser/RecordedAnswers';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ event?: string }> };

export default async function OrganiserAttendeesPage({ searchParams }: Props) {
  const { event: requested } = await searchParams;
  const { token, session } = await requireOrganiser();
  const events = await loadEvents(token);
  const event = pickEvent(events, requested);
  const attendees = event ? await loadAttendees(token, event.id) : [];
  return (
    <OrganiserShell title="Attendees" identity={identityOf(session)}>
      {!event ? (
        <Unavailable title="No events yet" detail="Attendees appear here once an event has registrations." />
      ) : (
        <div className="space-y-6">
          <EventPicker events={events} selectedId={event.id} />
          {attendees.length === 0 ? (
            <Unavailable title="No attendees for this event yet" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-eve-line bg-eve-surface">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Attendees for {event.name}</caption>
                <thead className="bg-eve-surface-alt text-xs uppercase tracking-wider text-eve-muted">
                  <tr><th scope="col" className="p-3">Attendee</th><th scope="col" className="p-3">Ticket</th><th scope="col" className="p-3">Session</th><th scope="col" className="p-3">Order</th><th scope="col" className="p-3">Checked in</th></tr>
                </thead>
                <tbody>
                  {attendees.map(a => (
                    <tr key={a.id} className="border-t border-eve-line">
                      <th scope="row" className="p-3 font-medium">{a.name}<span className="block text-xs font-normal text-eve-muted">Booked by {a.purchaser_name}</span><RecordedAnswers answers={a.answers} /></th>
                      <td className="p-3">{a.ticket_type_name ?? '—'}</td>
                      <td className="p-3">{a.session_name ?? '—'}</td>
                      <td className="p-3">{a.order_status === 'CANCELLED' ? 'Cancelled' : a.payment_status}</td>
                      <td className="p-3">{a.checked_in_at ? `${formatDateTime(a.checked_in_at, event.timezone)}${a.checked_in_by ? ` by ${a.checked_in_by}` : ''}` : 'Not yet'}</td>
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
