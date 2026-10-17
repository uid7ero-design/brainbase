import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { EventPicker } from '@/components/organiser/EventPicker';
import { CheckInConsole } from '@/components/organiser/CheckInConsole';
import { Unavailable } from '@/components/ui/primitives';
import { canManage, requireOrganiser } from '@/lib/organiserAuth';
import { identityOf } from '@/lib/identity';
import { loadEvents, pickEvent } from '@/lib/organiserData';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ event?: string }> };

export default async function OrganiserCheckInPage({ searchParams }: Props) {
  const { event: requested } = await searchParams;
  const { token, session } = await requireOrganiser();
  const events = await loadEvents(token);
  const event = pickEvent(events, requested);
  return (
    <OrganiserShell title="Check-in" identity={identityOf(session)}>
      {!event ? (
        <Unavailable title="No events yet" detail="Check-in is available once an event exists." />
      ) : (
        <div className="space-y-8">
          <EventPicker events={events} selectedId={event.id} />
          <CheckInConsole key={event.id} eventId={event.id} canManage={canManage(session.user.role)} />
        </div>
      )}
    </OrganiserShell>
  );
}
