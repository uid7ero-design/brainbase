import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { Unavailable } from '@/components/ui/primitives';

export default function OrganiserEventsPage() {
  return (
    <OrganiserShell title="Events">
      <Unavailable
        title="Events are not connected"
        detail="This list will show every event with its status (draft, published, cancelled), sessions and ticket types, and open the editor for each. No events are listed until the organiser account and the shared core are connected."
      />
    </OrganiserShell>
  );
}
