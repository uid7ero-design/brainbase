import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { Unavailable } from '@/components/ui/primitives';

export default function OrganiserAttendeesPage() {
  return (
    <OrganiserShell title="Attendees">
      <Unavailable
        title="Attendees are not connected"
        detail="Every ticket holder across an event, by session and ticket type, with check-in state and ticket email delivery status. Nothing is listed until connected."
      />
    </OrganiserShell>
  );
}
