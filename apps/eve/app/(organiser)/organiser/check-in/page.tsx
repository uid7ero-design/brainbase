import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { Unavailable } from '@/components/ui/primitives';

export default function OrganiserCheckInPage() {
  return (
    <OrganiserShell title="Check-in">
      <Unavailable
        title="Check-in is not connected"
        detail="Scan a QR ticket or search by name, admit each ticket exactly once, and undo a mistaken scan. Scanning requires a signed-in organiser and the shared core; neither is connected in this product yet."
      />
    </OrganiserShell>
  );
}
